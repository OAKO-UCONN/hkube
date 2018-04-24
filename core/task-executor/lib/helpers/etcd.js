const EventEmitter = require('events');
const EtcdClient = require('@hkube/etcd');
const Logger = require('@hkube/logger');
const component = require('../../common/consts/componentNames').ETCD;
const { templateStore } = require('../stubs/templateStore');
let log;
const WORKER_SERVICE_NAME_DEFAULT = 'worker';
class Etcd extends EventEmitter {
    constructor() {
        super();
        this._etcd = null;
    }

    async init(options) {
        log = Logger.GetLogFromContainer();
        this._etcd = new EtcdClient();
        log.info(`Initializing etcd with options: ${JSON.stringify(options.etcd)}`, { component });
        await this._etcd.init(options.etcd);
        this._etcd.jobs.watch({ jobId: 'hookWatch' });
        this._workerServiceName = options.workerServiceName || WORKER_SERVICE_NAME_DEFAULT;
        // push to etcd
        await Promise.all(Object.entries(templateStore).map(([alg, data]) => {
            return this._etcd.algorithms.templatesStore.setState({ alg, data });
        }));
    }

    async getWorkers(options = {}) {
        const workerServiceName = options.workerServiceName || this._workerServiceName;

        const workers = await this._etcd.discovery.get({ serviceName: workerServiceName });
        return workers;
    }

    async getAlgorithmRequests(options = {}) {
        return this._etcd.algorithms.resourceRequirements.list(options);
    }

    async getAlgorithmTemplate({ algorithmName }) {
        // return getAlgorithmTemplate({ algorithmName });
        return this._etcd.algorithms.templatesStore.getState({ alg: algorithmName });
    }
}

module.exports = new Etcd();