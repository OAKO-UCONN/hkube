
const { parser } = require('@hkube/parsers');
const Logger = require('@hkube/logger');
const { stateType } = require('@hkube/consts');
const stateAdapter = require('../../states/stateAdapter');
const { Statistics, Progress, PendingScale, Metrics } = require('../core');
const ScaleReasons = require('../core/scale-reasons');
const producer = require('../../producer/producer');
const discovery = require('./service-discovery');
const { Components } = require('../../consts');
const component = Components.AUTO_SCALER;
let log;

/**
 * The AutoScaler is the class that responsible
 * for scale up/down, this class used by the master adapter.
 */
class AutoScaler {
    constructor(options) {
        log = Logger.GetLogFromContainer();
        this._nodeName = options.nodeName;
        this._options = options;
        this._config = options.config;
        this._isStateful = options.node.stateType === stateType.Stateful;
        this.clean();
    }

    clean() {
        this._metrics = [];
        this._idles = Object.create(null);
        this._statsPrint = Object.create(null);
        this._progress = new Progress();
        this._statistics = new Statistics(this._config);
        this._pendingScale = new PendingScale(this._config);
    }

    report(data) {
        this._statistics.report(data);
    }

    getProgress() {
        return this._progress.data;
    }

    getMetrics() {
        return this._metrics;
    }

    scale() {
        const { scaleUp, scaleDown } = this._createScale();
        this._scaleUp(scaleUp);
        this._scaleDown(scaleDown);
        return { scaleUp, scaleDown };
    }

    _createScale() {
        let scaleUp = null;
        let scaleDown = null;
        const upList = [];
        const downList = [];
        this._metrics = [];
        let currentSize = 0;
        const nodeName = this._nodeName;

        for (const stat of this._statistics) {
            const { source, data } = stat;
            currentSize = data.currentSize || discovery.countInstances(nodeName);
            const { reqRate, resRate, durationsRate, totalRequests, totalResponses } = Metrics.CalcRates(stat.data, this._config);;

            const metric = { source, target: nodeName, currentSize, reqRate, resRate, durationsRate, totalRequests, totalResponses };
            this._metrics.push(metric);

            this._updateProgress(metric);
            this._printRatesStats(metric);

            if (!this._isStateful) {
                const result = this._getScaleDetails({ source, reqRate, resRate, durationsRate, currentSize });
                if (result.up) {
                    upList.push({ source, count: result.up, reason: result.reason });
                }
                else if (result.down) {
                    downList.push({ source, count: result.down, reason: result.reason });
                }
            }
        }
        this._pendingScale.check(currentSize);

        if (upList.length > 0 || downList.length > 0) {
            if (upList.length > 0 && downList.length > 0) {
                log.waring(`scaling collision detected, node ${upList[0].source} scale up ${upList[0].count}, and node ${downList[0].source} scale down ${downList[0].count}`, { component });
            }
            else if (upList.length > 0) {
                const up = this._findMaxIndex(upList);
                if (this._canScaleUp(up.count)) {
                    const scaleTo = currentSize + up.count;
                    scaleUp = { replicas: up.count, currentSize, scaleTo, reason: up.reason, nodes: upList.map(l => l.count) };
                    this._pendingScale.updateUp(scaleTo);
                }
            }
            else {
                const everyDown = downList.every(d => d.reason.code === 'IDLE_TIME');
                const down = (everyDown && downList[0]) || this._findMinIndex(downList);
                if (this._canScaleDown(down.count)) {
                    const scaleTo = currentSize - down.count;
                    this._pendingScale.updateDown(scaleTo);
                    scaleDown = { replicas: down.count, currentSize, scaleTo, reason: down.reason, nodes: downList.map(l => l.count) };
                }
            }
        }
        return { scaleUp, scaleDown };
    }

    _findMaxIndex(list) {
        let index;
        let max = 0;
        list.forEach((l, i) => {
            if (l.count > max) {
                max = l.count;
                index = i;
            }
        });
        return list[index] || { count: 0 };
    }

    _findMinIndex(list) {
        let index;
        let min = Number.MAX_SAFE_INTEGER;
        list.forEach((l, i) => {
            if (l.count < min) {
                min = l.count;
                index = i;
            }
        });
        return list[index] || { count: 0 };
    }

    _printRatesStats(metric) {
        if (!this._statsPrint[metric.source] || Date.now() - this._statsPrint[metric.source] >= 30000) {
            const count = [];
            if (this._pendingScale.requiredUp) {
                count.push(`require up ${this._pendingScale.requiredUp},`);
            }
            if (this._pendingScale.requiredDown) {
                count.push(`require down ${this._pendingScale.requiredDown},`);
            }
            const { source, target, currentSize, reqRate, resRate, durationsRate, totalRequests, totalResponses } = metric;
            log.info(`stats for ${source}=>${target}: size: ${currentSize}, ${count.join('')} req rate=${reqRate.toFixed(2)}, res rate=${resRate.toFixed(2)}, durations rate=${durationsRate.toFixed(2)}, total requests=${totalRequests}, total responses=${totalResponses}`, { component });
            this._statsPrint[metric.source] = Date.now();
        }
    }

    _updateProgress(metric) {
        const { source, reqRate, resRate } = metric;
        if (reqRate && resRate) {
            const progress = parseFloat((resRate / reqRate).toFixed(2));
            this._progress.update(source, progress);
        }
    }

    _getScaleDetails({ source, reqRate, resRate, durationsRate, currentSize }) {
        const result = { up: 0, down: 0 };
        const reqResRatio = this._calcRatio(reqRate, resRate);
        const durationsRatio = this._calcRatio(reqRate, durationsRate);
        const scaleUp = this._shouldScaleUp({ reqResRatio, reqRate, resRate });
        const scaleDown = this._shouldScaleDown({ source, durationsRatio, currentSize, reqRate, resRate });

        if (scaleUp.scale) {
            const scaleSize = this._calcSize(currentSize, reqResRatio);
            const replicas = Math.min(scaleSize, this._config.maxReplicas);
            result.up = replicas;
            result.reason = scaleUp.reason;
        }
        else if (scaleDown.scale) {
            let scaleSize;
            if (scaleDown.reason.code === 'DUR_RATIO') {
                scaleSize = this._calcSize(currentSize, durationsRatio);
                scaleSize = scaleSize >= currentSize ? currentSize - 1 : scaleSize;
            }
            else if (scaleDown.reason.code === 'IDLE_TIME') {
                scaleSize = currentSize;
            }
            const replicas = Math.min(scaleSize, currentSize);
            result.down = replicas;
            result.reason = scaleDown.reason;
        }
        return result;
    }

    _calcRatio(rate1, rate2) {
        const ratio = (rate1 && rate2) ? (rate1 / rate2) : 1;
        return ratio;
    }

    _calcSize(currentSize, ratio) {
        const size = currentSize || 1;
        return Math.ceil(size * ratio);
    }

    _logScaling({ action, currentSize, scaleTo, reason, nodes }) {
        const nodesScale = nodes.length > 0 ? `, nodes: [${nodes}]` : '';
        log.info(`scaling ${action} from ${currentSize} to ${scaleTo} replicas for node ${this._nodeName} ${reason.message} ${nodesScale}`, { component });
    }

    _shouldScaleUp({ reqResRatio, reqRate, resRate }) {
        let reason;
        let scale = false;

        if (reqResRatio >= this._config.minRatioToScaleUp) {
            scale = true;
            reason = ScaleReasons.REQ_RES({ reqResRatio: reqResRatio.toFixed(2), minRatioToScaleUp: this._config.minRatioToScaleUp });
        }
        else if (!resRate && reqRate > 0) {
            scale = true;
            reason = {
                code: 'REQ_ONLY',
                message: `based on no responses and requests rate of ${reqRate.toFixed(2)} msg per sec`
            };
        }
        return { scale, reason };
    }

    _shouldScaleDown({ source, durationsRatio, reqRate, resRate }) {
        let reason;
        let scale = false;

        if (!reqRate && !resRate) {
            const code = 'IDLE_TIME';
            const hasMinTime = this._markIdleTime({ source, code });
            if (hasMinTime) {
                scale = true;
                reason = {
                    code,
                    message: `based on no requests and no responses for ${this._config.minTimeIdleBeforeReplicaDown / 1000} sec`
                };
            }
        }
        else {
            this._unMarkIdleTime({ source, code: 'IDLE_TIME' });
        }
        if (durationsRatio <= this._config.minRatioToScaleDown) {
            const code = 'DUR_RATIO';
            const hasMinTime = this._markIdleTime({ source, code });
            if (hasMinTime) {
                scale = true;
                reason = {
                    code,
                    message: `based on durations ratio of ${durationsRatio.toFixed(2)} (min is ${this._config.minRatioToScaleDown})`
                };
            }
        }
        else {
            this._unMarkIdleTime({ source, code: 'DUR_RATIO' });
        }
        return { scale, reason };
    }

    _markIdleTime({ source, code }) {
        let result = false;
        if (!this._idles[source]) {
            this._idles[source] = {};
        }
        if (!this._idles[source][code]) {
            this._idles[source][code] = { time: Date.now() };
        }
        if (Date.now() - this._idles[source][code].time >= this._config.minTimeIdleBeforeReplicaDown) {
            result = true;
        }
        return result;
    }

    _unMarkIdleTime({ source, code }) {
        if (this._idles[source] && this._idles[source][code]) {
            delete this._idles[source][code];
        }
    }

    _canScaleUp(count) {
        return count > 0 && !this._pendingScale.hasDesiredUp();
    }

    _canScaleDown(count) {
        return count > 0 && !this._pendingScale.hasDesiredDown();
    }

    _scaleUp(scale) {
        if (!scale) {
            return null;
        }
        this._logScaling({ action: 'up', ...scale });
        const { replicas } = scale;
        const tasks = [];
        const parse = {
            flowInputMetadata: this._options.pipeline.flowInputMetadata,
            nodeInput: this._options.node.input,
            ignoreParentResult: true
        };
        const result = parser.parse(parse);
        for (let i = 0; i < replicas; i += 1) {
            const taskId = producer.createTaskID();
            const task = { taskId, input: result.input, storage: result.storage, batchIndex: i + 1 };
            tasks.push(task);
        }
        const job = {
            ...this._options.jobData,
            ...this._options.node,
            tasks,
            isScaled: true
        };
        return producer.createJob({ jobData: job });
    }

    _scaleDown(scale) {
        if (!scale) {
            return null;
        }
        this._logScaling({ action: 'down', ...scale });
        const { replicas } = scale;
        const instances = discovery.getInstances(this._nodeName);
        const workers = instances.slice(0, replicas);
        return Promise.all(workers.map(w => stateAdapter.stopWorker(w.workerId)));
    }
}

module.exports = AutoScaler;
