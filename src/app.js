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
 * FIX ME!
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




app.use('/contracts', contractsRouter);
app.use('/jobs', jobsRouter);
module.exports = app;
