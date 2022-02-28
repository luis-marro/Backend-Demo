const express = require('express');
const bodyParser = require('body-parser');
const {Op} = require('sequelize');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);
const contractsRouter = express.Router();
const jobsRouter = express.Router();
const adminRouter = express.Router();

/**
 *
 * @returns contract by id
 */
contractsRouter.get('/:id', getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models');
    const {id} = req.params;
    const contract = await Contract.findOne({where: {id}});
    if(contract.ContractorId !== req.profile.id && contract.ClientId !== req.profile.id) return res.status(403).json({message: 'You do not have access to the requested contract'});
    if(!contract) return res.status(404).end();
    res.json(contract);
})

contractsRouter.get('/', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models');
    const filter = {
        [Op.not]: {status: 'terminated'},
        [Op.or]: {ContractorId: req.profile.id, ClientId: req.profile.id}
    };
    const contracts = await Contract.findAll({where: filter})
    res.status(200).json(contracts);
})

jobsRouter.get('/unpaid', getProfile, async (req, res) => {
    const {Contract, Job} = req.app.get('models');
    const filter = {
        where: {[Op.or]: [{paid: null}, {paid: false}]},
        include: [{
            model: Contract,
            required: true,
            where: {
                [Op.or]: {ContractorId: req.profile.id, ClientId: req.profile.id},
                [Op.not]: {status: 'terminated'},
            }
        }]
    }
    const jobs = await Job.findAll(filter);
    console.log(jobs.length);
    res.status(200).json(jobs);
})

jobsRouter.put('/:job_id/pay', getProfile, async (req, res) => {
    const {Job, Profile, Contract} = req.app.get('models');
    const transaction = await sequelize.transaction({
        isolationLevel: 'SERIALIZABLE'
    })
    try {
        // get the balance of a client
        const client = await Profile.findOne({where: {id: req.profile.id}, transaction});
        if (client.type !== 'client') {
            transaction.commit();
            return res.status(400).json({message: 'Only a client can pay for a job'});
        }
        const job = await Job.findOne({where: {id: req.params.job_id}, transaction});
        // Check if the job belongs to the client
        const contract = await Contract.findOne({where: {id: job.ContractId}});
        if(contract.ClientId !== req.profile.id) {
            transaction.commit();
            return res.status(403).json({message: 'You cannot pay for this contract'});
        }
        if (job.paid) {
            transaction.commit();
            return res.status(200).json({message: `The job ${job.description} is already paid for`});
        }
        if (job.price > client.balance) {
            transaction.commit();
            return res.status(422).json({message: 'Cannot complete payment because balance is below payment amount'});
        }
        await Job.update({paid: true}, {where: {id: job.id}, transaction: transaction});
        await Profile.update({balance: client.balance - job.price}, {where: {id: client.id}, transaction: transaction});
        await transaction.commit();
        res.status(200).end();
    }catch (error){
        await transaction.rollback();
        console.error(error);
        res.status(500).json({message: 'Error Paying for Job'});
    }
})

app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const {Profile, Job, Contract} = req.app.get('models');
    if(!req.body.amount) return res.status(400).json({message: 'Please specify the amount for the deposit'});
    const clientToDeposit = await Profile.findOne({where: {id: req.params.userId}});
    if(clientToDeposit.type !== 'client') return res.status(422).json({message: 'The specified user is not a Client'});
    const contractFilter = {
        where: { // Jobs Filter
            [Op.or]: [{paid: null}, {paid: false}]
        },
        include: [{ // contracts filter
            model: Contract,
            required: true,
            where: {
                ClientId: req.profile.id,
                [Op.not]: {status: 'terminated'},
            }
        }]
    }
    const allJobs = await Job.findAll(contractFilter);
    let totalDue = 0;
    allJobs.forEach(job => {
        totalDue += job.price;
    })
    if((totalDue * 0.25) < req.body.amount) return res.status(422).json({message: 'Cannot deposit to client, because specified amount is higher than 25% of your current jobs'})
    // Update the users balance
    await Profile.update({balance: clientToDeposit.balance + req.body.amount}, {where: {id: req.params.userId}});
    res.status(200).json({message: 'Successfully updated the user\'s balance'});
})

adminRouter.get('/best-profession',async (req, res) => {
    const {Job, Contract, Profile} = app.get('models');
    const startDate = new Date(req.query.start).toISOString();
    const endDate = new Date(req.query.end).toISOString();
    console.log(startDate, endDate);
    const filter = {
        attributes: ['id', 'ContractorId'],
        group: ['Contract.id'],
        include: [
            {
                model: Job,
                required: true,
                attributes: [[sequelize.fn('SUM', sequelize.col('price')), 'total']],
                group: ['Contract.ContractorId'],
                where: {
                    updatedAt: {
                        [Op.between]: [startDate, endDate]
                    },
                    paid: true
                }
            }
        ]
    }
    const contracts = await Contract.findAll(filter);
    const contractors = {};
    let maxContractor = contracts[0].ContractorId;
    contracts.forEach(contractTotal => {
        if(contractors[contractTotal.ContractorId]) contractors[contractTotal.ContractorId] += contractTotal.Jobs[0].dataValues.total;
        else contractors[contractTotal.ContractorId] = contractTotal.Jobs[0].dataValues.total;
        if(contractors[contractTotal.ContractorId] > contractors[maxContractor]) maxContractor = contractTotal.ContractorId;
    })
    // Get the profile of the highest earning contractor
    const profile = await Profile.findOne({attributes: ['profession'], where: {id: maxContractor}});
    res.status(200).json({profession: profile.profession});
})

adminRouter.get('/best-clients', async (req, res) => {
    const {Job, Contract, Profile} = app.get('models');
    const startDate = new Date(req.query.start).toISOString();
    const endDate = new Date(req.query.end).toISOString();
    const limit = req.query.limit? req.query.limit : 2;
    console.log(startDate, endDate, limit);
    const filter = {
        attributes: ['id', 'ClientId'],
        group: ['Contract.id'],
        include: [
            {
                model: Job,
                required: true,
                attributes: [[sequelize.fn('SUM', sequelize.col('price')), 'total']],
                group: ['Contract.ContractorId'],
                where: {
                    updatedAt: {
                        [Op.between]: [startDate, endDate]
                    },
                    paid: true
                }
            }
        ]
    }
    const contracts = await Contract.findAll(filter);
    const clients = {};
    const sortable = [];
    contracts.forEach(contractTotal => {
        if(clients[contractTotal.ClientId]) clients[contractTotal.ClientId] += contractTotal.Jobs[0].dataValues.total;
        else clients[contractTotal.ClientId] = contractTotal.Jobs[0].dataValues.total;
    })
    Object.keys(clients).forEach(key => {
        sortable.push({ClientId: key, amountPaid: clients[key]});
    })
    sortable.sort((a, b) => b.amountPaid - a.amountPaid);
    const clientsArray = [];
    const loopLimit = limit > sortable.length? sortable.length : limit;
    for(let i = 0; i < loopLimit; i++){
        const profile = await Profile.findOne({attributes: ['firstName', 'lastName'], where: {id: sortable[i].ClientId}});
        clientsArray.push({
            id: sortable[i].ClientId,
            fullName: profile.firstName + ' ' + profile.lastName,
            paid: sortable[i].amountPaid
        })
    }
    res.status(200).json(clientsArray);
})

app.use('/contracts', contractsRouter);
app.use('/jobs', jobsRouter);
app.use('/admin', adminRouter);
module.exports = app;
