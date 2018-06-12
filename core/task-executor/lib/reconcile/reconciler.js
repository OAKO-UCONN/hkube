const Logger = require('@hkube/logger');
const log = Logger.GetLogFromContainer();
const { createJobSpec } = require('../jobs/jobCreator');
const kubernetes = require('../helpers/kubernetes');
const etcd = require('../helpers/etcd');
const { workerCommands } = require('../../common/consts/states');
const component = require('../../common/consts/componentNames').RECONCILER;
const { normalizeWorkers, normalizeRequests, normalizeJobs, mergeWorkers, normalizeResources } = require('./normalize');
const { setWorkerImage, createContainerResource, setAlgorithmImage } = require('./createOptions');
const MAX_JOBS_PER_TICK = 30;
const CPU_RATIO_PRESURE = 0.8;
const MEMORY_RATIO_PRESURE = 0.8;
const _createJobs = async (numberOfJobs, jobDetails) => {
    log.debug(`need to add ${numberOfJobs} jobs with details ${JSON.stringify(jobDetails, null, 2)}`, { component });
    if (numberOfJobs > MAX_JOBS_PER_TICK) {
        numberOfJobs = MAX_JOBS_PER_TICK;
    }

    const results = Array.from(Array(numberOfJobs).keys()).map(() => {
        const spec = createJobSpec(jobDetails);
        const jobCreateResult = kubernetes.createJob({ spec });
        return jobCreateResult;
    });
    return Promise.all(results);
};

const _pendingJobjsFilter = (job, algorithmName) => {
    const match = job.algorithmName === algorithmName;
    return match;
};
const _idleWorkerFilter = (worker, algorithmName) => {
    const match = worker.algorithmName === algorithmName && worker.workerStatus === 'ready' && !worker.workerPaused;
    return match;
};
const _pausedWorkerFilter = (worker, algorithmName) => {
    const match = worker.algorithmName === algorithmName && worker.workerStatus === 'ready' && worker.workerPaused;
    return match;
};

const _stopWorkers = (workers, count) => {
    // sort workers so paused ones are in front
    const sorted = workers.slice().sort((a, b) => (b.workerPaused - a.workerPaused));
    const promises = sorted.slice(0, count).map((w) => {
        const workerId = w.id;
        return etcd.sendCommandToWorker({ workerId, command: workerCommands.stopProcessing });
    });
    return Promise.all(promises);
};

const _resumeWorkers = (workers, count) => {
    const sorted = workers.slice().sort((a, b) => (b.workerPaused - a.workerPaused));
    const promises = sorted.slice(0, count).map((w) => {
        const workerId = w.id;
        return etcd.sendCommandToWorker({ workerId, command: workerCommands.startProcessing });
    });
    return Promise.all(promises);
};


const reconcile = async ({ algorithmRequests, algorithmPods, jobs, versions, resources } = {}) => {
    const normPods = normalizeWorkers(algorithmPods);
    const normJobs = normalizeJobs(jobs, j => !j.status.succeeded);
    const merged = mergeWorkers(normPods, normJobs);
    const normRequests = normalizeRequests(algorithmRequests);
    const normResouces = normalizeResources(resources);
    const isCpuPresure = normResouces.allNodes.ratio.cpu > CPU_RATIO_PRESURE;
    const isMemoryPresure = normResouces.allNodes.ratio.memory > MEMORY_RATIO_PRESURE;
    const isResourcePresure = isCpuPresure || isMemoryPresure;
    const createPromises = [];
    const reconcileResult = {};
    for (let r of normRequests) { // eslint-disable-line
        const { algorithmName } = r;
        // find workers currently for this algorithm
        const workersForAlgorithm = merged.mergedWorkers.filter(w => _idleWorkerFilter(w, algorithmName));
        const pausedWorkers = merged.mergedWorkers.filter(w => _pausedWorkerFilter(w, algorithmName));
        const pendingWorkers = merged.extraJobs.filter(j => _pendingJobjsFilter(j, algorithmName));
        reconcileResult[algorithmName] = {
            required: r.pods,
            idle: workersForAlgorithm.length,
            paused: pausedWorkers.length,
            pending: pendingWorkers.length
        };
        let requiredCount = r.pods;
        if (requiredCount > 0 && pausedWorkers.length > 0) {
            const canWakeWorkersCount = requiredCount > pausedWorkers.length ? pausedWorkers.length : requiredCount;
            if (canWakeWorkersCount > 0) {
                log.debug(`waking up ${canWakeWorkersCount} pods for algorithm ${algorithmName}`, { component });
                createPromises.push(_resumeWorkers(pausedWorkers, canWakeWorkersCount));
                requiredCount -= canWakeWorkersCount;
            }
        }
        const podDiff = (workersForAlgorithm.length + pendingWorkers.length) - requiredCount;

        if (podDiff > 0) {
            // need to stop some workers
            if (isResourcePresure) {
                log.debug(`need to stop ${podDiff} pods for algorithm ${algorithmName}`);
                _stopWorkers(workersForAlgorithm, podDiff);
            }
            else {
                log.debug(`resources ratio is: ${JSON.stringify(normResouces.allNodes.ratio)}. no need to stop pods`);
            }
        }
        else if (podDiff < 0) {
            // need to add workers
            const numberOfNewJobs = -podDiff;

            log.debug(`need to add ${numberOfNewJobs} pods for algorithm ${algorithmName}`, { component });

            const algorithmTemplate = await etcd.getAlgorithmTemplate({ algorithmName }); // eslint-disable-line
            const algorithmImage = setAlgorithmImage(algorithmTemplate, versions);
            const workerImage = setWorkerImage(algorithmTemplate, versions);
            const resourceLimits = createContainerResource(algorithmTemplate);
            const { workerEnv, algorithmEnv } = algorithmTemplate;
            createPromises.push(_createJobs(numberOfNewJobs, {
                algorithmName,
                algorithmImage,
                workerImage,
                workerEnv,
                algorithmEnv,
                resourceLimits
            }));
        }
    }
    await Promise.all(createPromises);
    return reconcileResult;
};

module.exports = {
    reconcile,
};
