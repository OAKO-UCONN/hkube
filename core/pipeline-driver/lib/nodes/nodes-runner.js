const uuidv4 = require('uuid/v4');
const producer = require('lib/producer/jobs-producer');
const stateManager = require('lib/state/state-manager');
const progress = require('lib/progress/nodes-progress');
const NodesMap = require('lib/nodes/nodes-map');
const States = require('lib/state/States');
const NodeState = require('lib/state/NodeState');
const inputParser = require('lib/parsers/input-parser');
const Batch = require('lib/nodes/batch');
const Logger = require('@hkube/logger');
const log = Logger.GetLogFromContainer();
const components = require('common/consts/componentNames');

class NodesRunner {

    constructor() {
        this._job = null;
        this._pipeline = null;
        this._nodes = null;
        this._tasks = null;
        this._watch();
    }

    _watch() {
        stateManager.on('task-change', async (data) => {
            const task = this._tasks.get(data.taskId);
            const node = new NodeState({
                nodeName: task.nodeName,
                batchID: task.batchID,
                status: data.status
            });
            switch (data.status) {
                case States.COMPLETED:
                    await stateManager.unWatchTask({ taskId: task.taskId });
                    log.info(`task completed ${task.taskId}`, { component: components.JOBS_PRODUCER });
                    node.result = data.result;
                    this._setTaskState(task.taskId, node);
                    const calc = this._nodes.calc();
                    progress.info({ progress: calc.progress, details: calc.details, status: States.ACTIVE });
                    this._taskComplete(node);
                    break;
                case States.FAILED:
                    log.error(`task failed ${task.taskId}, error: ${data.error}`, { component: components.JOBS_PRODUCER });
                    node.error = data.error;
                    this._setTaskState(task.taskId, node);
                    this._taskComplete(node);
                    break;
            }
        });
    }

    init(options) {
        this._config = options;
        producer.on('task-waiting', (taskId) => {
            this._updateStatus(taskId, States.PENDING);
        })
        producer.on('task-active', (taskId) => {
            this._updateStatus(taskId, States.ACTIVE);
        })
        producer.on('job-start', async (job) => {
            try {
                await this._start(job);
            }
            catch (error) {
                progress.error({ status: States.FAILED, error: error.message });
                this._jobComplete({ error: error.message });
            }
        })
        producer.on('job-stop', (data) => {
            this._onJobStop(data);
        })
    }

    async _jobComplete(error) {
        await stateManager.unWatchJobState();

        if (this._tasks) {
            this._tasks.forEach((value, key) => {
                stateManager.unWatchTask({ taskId: key });
            })
        }

        this._job.done(error);
        this._job = null;
        this._pipeline = null;
        this._nodes = null;
        this._tasks = null;
    }

    async _onJobStop(data) {
        log.info(`pipeline stopped ${this._job.id}`, { component: components.JOBS_PRODUCER });
        progress.info({ status: States.STOPPED });
        this._jobComplete();
    }

    _updateStatus(taskId, status) {
        log.info(`task ${status} ${taskId}`, { component: components.JOBS_PRODUCER });
        const task = this._tasks.get(taskId);
        const node = new NodeState({
            nodeName: task.nodeName,
            batchID: task.batchID,
            status: status
        });
        this._setTaskState(taskId, node);
    }

    async _start(job) {
        log.info(`pipeline started ${job.id}`, { component: components.JOBS_PRODUCER });
        this._job = job;
        stateManager.setCurrentJob(this._job);

        const watchState = await stateManager.watchJobState();
        if (watchState && watchState.obj && watchState.obj.state === States.STOPPED) {
            this._onJobStop();
        }
        this._pipeline = await stateManager.getExecution({ jobId: job.id });
        this._nodes = new NodesMap(this._pipeline, this._config);
        this._tasks = new Map();

        // first we will try to get the state for this job
        const state = await stateManager.getState();
        if (state) {
            stateManager.setState({ data: States.RECOVERING });
            this._recover(state);
        }
        else {
            stateManager.setState({ data: States.ACTIVE });
            progress.info({ status: States.ACTIVE });
            this._startNodes(job.data);
        }
    }

    async _watchTask(options) {
        this._tasks.set(options.taskId, options);
        await stateManager.watchTask({ taskId: options.taskId });
    }

    _runCompleted(nodeName) {
        const childs = this._nodes.childs(nodeName);
        childs.forEach(child => {
            const node = this._nodes.getNode(child);
            const waitAnyIndex = inputParser.waitAnyInputIndex(node.input);
            if (waitAnyIndex > -1) {
                this._runWaitAny(child, data.result);
            }
            else {
                const allFinished = this._nodes.isAllParentsFinished(child);
                if (allFinished) {
                    const results = this._nodes.parentsResults(child);
                    this._runNode(child, results);
                }
            }
        });
    }

    _runNode(nodeName, nodesInput) {
        const node = this._nodes.getNode(nodeName);
        const options = Object.assign({}, { flowInput: this._pipeline.flowInput }, { input: node.input });
        const result = inputParser.parse(options, node.input, nodesInput);
        this._runNodeInner(node, result);
    }

    _runNodeInner(node, data) {
        if (data.batch) {
            this._runBatch(node.name, data.input);
        }
        else {
            this._nodes.setNode(node.name, { input: data.input });
            this._createJob(node);
        }
    }

    _runBatch(nodeName, batchArray) {
        const node = this._nodes.getNode(nodeName);
        if (!Array.isArray(batchArray)) {
            throw new Error(`node ${nodeName} batch input must be an array`);
        }
        const options = Object.assign({}, this._pipeline, node);
        batchArray.forEach((inp, ind) => {
            const batch = new Batch({
                name: node.name,
                batchID: `${node.name}#${(ind + 1)}`,
                algorithm: node.algorithm,
                input: inp
            });
            this._nodes.addBatch(batch);
            this._createJob(batch);
        })
    }

    _runWaitAny(nodeName, nodeInput) {
        const node = this._nodes.getNode(nodeName);
        const waitAnyIndex = inputParser.waitAnyInputIndex(node.input);
        const input = node.input.slice();
        input.forEach((inp, ind) => {
            if (inputParser.isWaitAnyBatch(inp)) {
                const nodeInput = node.input[waitAnyIndex].substr(2);
                this._runBatch(nodeName, nodeInput, waitAnyIndex);
            }
            else if (inputParser.isWaitAnyNode(inp)) {
                const ndName = node.input[waitAnyIndex].substr(2);
                const result = inputParser.extractObject(ndName);
                input[waitAnyIndex] = inputParser.parseValue(nodeInput, result.path);
            }
            else if (inputParser.isNode(inp)) {
                const ndName = node.input[ind].substr(1);
                const result = inputParser.extractObject(ndName);
                input[ind] = inputParser.parseValue(nodeInput, result.path);
            }
        });
        this._nodes.setNode(node.name, { input: input });
        this._createJob(node);
    }

    // TODO: HANDLE BATCH FAILED BELOW batchTolerance
    _taskComplete(node) {
        node = node || {};
        if (node.error) {
            if (node.batchID) {
                const batchTolerance = this._pipeline.batchTolerance || this._config.defaultBatchTolerance;
                const states = this._nodes.getNodeStates(node.nodeName);
                const failed = states.filter(s => s === States.FAILED);
                const percent = failed.length / states.length * 100;

                if (percent >= batchTolerance) {
                    log.error(`pipeline failed with ${failed.length}/${states.length} failed tasks, (${percent}%), batch tolerance is ${batchTolerance}%`, { component: components.JOBS_PRODUCER });
                    progress.error({ status: States.FAILED, error: node.error });
                    this._jobComplete(node.error);
                    return;
                }
            }
            else {
                log.error(`pipeline failed ${this._job.id}, error: ${node.error}`, { component: components.JOBS_PRODUCER });
                progress.error({ status: States.FAILED, error: node.error });
                this._jobComplete(node.error);
                return;
            }
        }
        if (this._nodes.isAllNodesDone()) {
            log.info(`pipeline completed ${this._job.id}`, { component: components.JOBS_PRODUCER });
            const result = this._nodes.allNodesResults();
            stateManager.setJobResults({ result: result });
            progress.info({ status: States.COMPLETED });
            this._jobComplete(null);
        }
        else {
            this._runCompleted(node.nodeName);
        }
    }

    _recover(state) {
        const nodes = state.driverTasks.map(t => t.nodeName).filter((v, i, a) => a.indexOf(v) === i);
        nodes.forEach(n => {
            const node = this._nodes.getNode(n);
            const options = Object.assign({}, { flowInput: this._pipeline.flowInput }, { input: node.input });
            const result = inputParser.parse(options, node.input);

            if (result.batch) {
                result.input.forEach((inp, ind) => {
                    const batch = new Batch({
                        name: node.name,
                        batchID: `${node.name}#${(ind + 1)}`,
                        algorithm: node.algorithm,
                        input: inp
                    });
                    this._nodes.addBatch(batch);
                })
            }
            else {
                this._nodes.setNode(node.name, { input: result.input });
            }
        });

        state.driverTasks.forEach(driverTask => {
            const jobTask = state.jobTasks.get(driverTask.taskId);
            if (jobTask && jobTask.status !== driverTask.status) {
                if (jobTask.status === States.COMPLETED) {
                    const node = new NodeState({
                        nodeName: driverTask.nodeName,
                        batchID: driverTask.batchID,
                        result: jobTask.result,
                        status: States.COMPLETED
                    });
                    log.info(`found completed task ${driverTask.taskId} after recover`, { component: components.JOBS_PRODUCER });
                    this._setTaskState(driverTask.taskId, node);
                    this._taskComplete(node);
                }
                else if (jobTask.status === States.FAILED) {
                    const node = new NodeState({
                        nodeName: driverTask.nodeName,
                        batchID: driverTask.batchID,
                        error: jobTask.error,
                        status: States.FAILED
                    });
                    log.info(`found failed task ${driverTask.taskId} after recover`, { component: components.JOBS_PRODUCER });
                    this._setTaskState(driverTask.taskId, node);
                    this._taskComplete(node);
                }
                else {
                    this._watchTask({
                        taskId: driverTask.taskId,
                        nodeName: driverTask.nodeName,
                        batchID: driverTask.batchID
                    });
                }
            }
        });
    }

    _setTaskState(taskId, data) {
        this._nodes.updateNodeState(data.nodeName, data.batchID, { state: data.status, error: data.error, result: data.result });
        stateManager.setTaskState({ taskId: taskId, data: data });
    }

    _startNodes(options) {
        const entryNodes = this._nodes.findEntryNodes();
        if (entryNodes.length === 0) {
            throw new Error('unable to find entry nodes');
        }
        entryNodes.forEach(n => this._runNode(n));
    }

    async _createJob(node) {
        const taskId = this._createTaskID(node.algorithm);
        await this._watchTask({ taskId: taskId, nodeName: node.name, batchID: node.batchID });
        await producer.createJob(node, this._job.id, taskId);
    }

    _createTaskID(type) {
        return [type, uuidv4()].join(':');
    }
}

module.exports = new NodesRunner();
