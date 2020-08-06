const async = require('async');
const throttle = require('lodash.throttle');
const levels = require('@hkube/logger').Levels;
const groupBy = require('../helpers/group-by');

class ProgressManager {
    constructor(option) {
        const options = option || {};
        const type = options.type || 'batch';
        this._currentProgress = 0;
        this._progressTypes = {
            batch: (...args) => this.calcProgressBatch(...args),
            stream: (...args) => this.calcProgressStream(...args)
        };
        this._calcProgress = this._progressTypes[type];
        this._getGraphStats = options.getGraphStats;
        this._sendProgress = options.sendProgress;
        this._throttleProgress = throttle(this._queueProgress.bind(this), 1000, { trailing: true, leading: true });

        this._queue = async.queue((task, callback) => {
            this._sendProgress(task).then(response => callback(null, response)).catch(error => callback(error));
        }, 1);
    }

    get currentProgress() {
        return this._currentProgress;
    }

    trace(data) {
        return this._progress(levels.TRACE.name, data);
    }

    silly(data) {
        return this._progress(levels.SILLY.name, data);
    }

    debug(data) {
        return this._progress(levels.DEBUG.name, data);
    }

    info(data) {
        return this._progress(levels.INFO.name, data);
    }

    warning(data) {
        return this._progress(levels.WARN.name, data);
    }

    error(data) {
        return this._progress(levels.ERROR.name, data);
    }

    critical(data) {
        return this._progress(levels.CRITICAL.name, data);
    }

    _progress(level, options) {
        const data = this._calcProgress();
        this._currentProgress = data.progress;
        return this._throttleProgress({ ...options, data, level });
    }

    _queueProgress(options) {
        return new Promise((resolve, reject) => {
            this._queue.push(options, (err, res) => {
                if (err) {
                    return reject(err);
                }
                return resolve(res);
            });
        });
    }

    calcProgressBatch() {
        const calc = {
            progress: 0,
            details: '',
            states: {}
        };
        const nodes = this._getGraphStats();
        if (nodes.length === 0) {
            return calc;
        }
        const groupedStates = groupBy.groupBy(nodes, 'status');
        const reduceStates = groupBy.reduce(groupedStates);
        const textStates = groupBy.text(reduceStates);

        const succeed = groupedStates.succeed ? groupedStates.succeed.length : 0;
        const failed = groupedStates.failed ? groupedStates.failed.length : 0;
        const skipped = groupedStates.skipped ? groupedStates.skipped.length : 0;
        const completed = succeed + failed + skipped;

        calc.progress = parseFloat(((completed / nodes.length) * 100).toFixed(2));
        calc.states = reduceStates;
        calc.details = `${calc.progress}% completed, ${textStates}`;

        return calc;
    }

    calcProgressStream() {
        const calc = {
            progress: 0,
            details: '',
            states: {}
        };
        const nodes = this._getGraphStats();
        if (nodes.length === 0) {
            return calc;
        }
        const groupedStates = groupBy.groupBy(nodes, 'status');
        const reduceStates = groupBy.reduce(groupedStates);

        const throughput = nodes.map(n => n.throughput);
        const median = this._median(throughput);
        calc.progress = parseFloat((median * 100).toFixed(2));
        calc.states = reduceStates;

        return calc;
    }

    _median(array) {
        if (!array || array.length === 0) {
            return 0;
        }
        array.sort();
        const half = Math.floor(array.length / 2);
        const median = array.length % 2 ? array[half] : (array[half - 1] + array[half]) / 2.0;
        return median;
    }
}

module.exports = ProgressManager;
