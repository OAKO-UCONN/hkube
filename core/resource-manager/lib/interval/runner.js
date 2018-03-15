const adapterManager = require('../adapters/adapters-manager');
const metricsRunner = require('../metrics/metrics-runner');
const stateManager = require('../state/state-manager');
const log = require('@hkube/logger').GetLogFromContainer();
const component = require('../../common/consts/componentNames').AlgorithmDb;

class Runner {

    constructor() {
    }

    async init() {


        setInterval(async () => {
            if (this._working) {
                return;
            }

            this._working = true;

            log.info(`adapterManager started`, { component });

            const adapterResults = await adapterManager.getData();
            const data = {
                queueMetrics: adapterResults.queueMetrics,
                templatesStore: adapterResults.templatesStore,

            }
            // const metricsResults = metricsRunner.run(adapterResults);
            // await stateManager.setTaskState();

            log.info(`adapterManager finished`, { component });

            this._working = false;


        }, 1000);
    }
}

module.exports = new Runner();