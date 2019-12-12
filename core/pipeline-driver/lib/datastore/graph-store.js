
const clone = require('clone');
const isEqual = require('lodash.isequal');
const deep = require('deep-get-set');
const flatten = require('flat');
const logger = require('@hkube/logger');
const States = require('../state/NodeStates');
const RedisStorage = require('./redis-storage-adapter');
const components = require('../consts/componentNames');
const INTERVAL = 4000;
let log;

class GraphStore {
    constructor() {
        this._interval = null;
        this._nodesMap = null;
        this._currentJobID = null;
    }

    init() {
        log = logger.GetLogFromContainer();
    }

    async start(jobId, nodeMap) {
        this._currentJobID = jobId;
        this._nodesMap = nodeMap;
        await this._store();
        this._storeInterval();
    }

    async stop() {
        await this._store();
        clearInterval(this._interval);
        this._interval = null;
        this._nodesMap = null;
        this._currentJobID = null;
    }

    getGraph(options) {
        return RedisStorage.getGraph({ jobId: options.jobId });
    }

    _storeInterval() {
        if (this._interval) {
            return;
        }
        this._interval = setInterval(async () => {
            if (this._working) {
                return;
            }
            this._working = true;
            await this._store();
            this._working = false;
        }, INTERVAL);
    }

    async _store() {
        try {
            if (this._nodesMap) {
                const graph = this._nodesMap.getJSONGraph();
                await this._updateGraph(graph);
            }
        }
        catch (error) {
            log.error(error.message, { component: components.GRAPH_STORE }, error);
        }
    }

    async _updateGraph(graph) {
        const filterGraph = this._filterData(graph);
        if (!isEqual(this._lastGraph, filterGraph)) {
            this._lastGraph = filterGraph;
            await RedisStorage.updateGraph({ jobId: this._currentJobID, data: { jobId: this._currentJobID, timestamp: Date.now(), ...filterGraph } });
        }
    }

    _formatEdge(e) {
        const edge = {
            from: e.v,
            to: e.w,
            edges: e.value
        };
        return edge;
    }

    _filterData(graph) {
        return {
            edges: graph.edges.map(e => this._formatEdge(e)),
            nodes: graph.nodes.map(n => this._formatNode(n.value))
        };
    }

    _formatNode(node) {
        if (node.batch.length === 0) {
            return this._handleSingle(node);
        }
        return this._handleBatch(node);
    }

    _mapTask(task) {
        return {
            taskId: task.taskId,
            input: this._parseInput(task),
            output: task.result,
            podName: task.podName,
            status: task.status,
            error: task.error,
            prevErrors: task.prevErrors,
            retries: task.retries,
            batchIndex: task.batchIndex,
            startTime: task.startTime,
            endTime: task.endTime
        };
    }

    _handleSingle(n) {
        const node = {
            nodeName: n.nodeName,
            algorithmName: n.algorithmName,
            ...this._mapTask(n)
        };
        return node;
    }

    _handleBatch(n) {
        const node = {
            nodeName: n.nodeName,
            algorithmName: n.algorithmName,
            batch: n.batch.map(b => this._mapTask(b)),
            batchInfo: this._batchInfo(n.batch)
        };
        return node;
    }

    _parseInput(node) {
        if (!node.input) {
            return null;
        }
        const result = clone(node.input);
        const flatObj = flatten(node.input);

        Object.entries(flatObj).forEach(([objectPath, value]) => {
            if (typeof value === 'string' && value.startsWith('$$')) {
                const key = value.substring(2);
                const link = node.storage[key];
                deep(result, objectPath, link.storageInfo);
            }
        });
        return result;
    }

    _batchInfo(batch) {
        const batchInfo = {
            idle: 0,
            completed: 0,
            errors: 0,
            running: 0,
            total: batch.length
        };
        batch.forEach((b) => {
            if (b.error) {
                batchInfo.errors += 1;
            }
            if (b.status === States.SUCCEED || b.status === States.FAILED) {
                batchInfo.completed += 1;
            }
            else if (b.status === States.CREATING || b.status === States.PENDING) {
                batchInfo.idle += 1;
            }
            else {
                batchInfo.running += 1;
            }
        });
        return batchInfo;
    }
}

module.exports = new GraphStore();
