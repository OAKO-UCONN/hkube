// const delay = require('await-delay');
const {componentName} = require('./consts/index');
const pipelineProducer = require('./pipeline-producer');
const log = require('@hkube/logger').GetLogFromContainer();
const {queue} = require('async');
const triggers = require('./triggers');
// const INTERVAL = 500;
class TriggerQueue {
    constructor() {
        this.triggerMap = [];
        this.config = null;
    }
    async init(config) {
        log.info('trigger-runner is started', { component: componentName.TRIGGER_QUEUE});
        this.config = config;
        this.runQueue();
        this._initTriggers();
    }
    _initTriggers() {
        Object.values(triggers).forEach(t => t.init());
    }

    async runQueue() {
        this.queue = queue((trigger, callback) => {
            pipelineProducer.produce(trigger.name, trigger.flowInput).then(() => {
                log.info(`pipeline ${trigger.name} sent successfully`, { component: componentName.TRIGGER_QUEUE});
                callback();
            });
        }, 1);
    }

    addTrigger(trigger, cb) {
        log.info(`task added to queue with ${trigger.name}`, { component: componentName.TRIGGER_QUEUE});
        this.queue.push(trigger, (err) => {
            log.info(`pipeline ${trigger.name} sent to api server`, { component: componentName.TRIGGER_QUEUE});
            cb(err);
        });        
    }
}
module.exports = new TriggerQueue();