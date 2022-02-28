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
    const {Job, Profile} = req.app.get('models');
    const transaction = await sequelize.transaction({
        isolationLevel: 'SERIALIZABLE'
    })
    try {
        // get the balance of a client
        const client = await Profile.findOne({where: {id: req.profile.id}}, {transaction});
        if (client.type !== 'client') return res.status(400).json({message: 'Only a client can pay for a job'});
        const job = await Job.findOne({where: {id: req.params.job_id}}, {transaction});
        if (job.paid) return res.status(200).json({message: `The job ${job.description} is already paid for`});
        if (job.price > client.balance) res.status(422).json({message: 'Cannot complete payment because balance is below payment amount'});
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


app.use('/contracts', contractsRouter);
app.use('/jobs', jobsRouter);
module.exports = app;
