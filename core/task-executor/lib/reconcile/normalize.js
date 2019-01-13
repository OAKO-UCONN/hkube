const sumBy = require('lodash.sumby');
const groupBy = require('lodash.groupby');
const parse = require('@hkube/units-converter');
const objectPath = require('object-path');
const { gpuVendors } = require('../consts');

/**
 * normalizes the worker info from discovery
 * input will look like:
 * <code>
 * {
 *  '/discovery/workers/worker-uuid':{
 *      algorithmName,
 *      workerStatus,
 *      jobStatus,
 *      error
 *      },
 *  '/discovery/workers/worker-uuid2':{
 *      algorithmName,
 *      workerStatus,
 *      jobStatus,
 *      error
 *      }
 * }
 * </code>
 * normalized output should be:
 * <code>
 * {
 *   worker-uuid:{
 *     algorithmName,
 *     workerStatus // ready, working
 * 
 *   }
 * }
 * </code>
 * @param {*} workers 
 */

const normalizeWorkers = (workers) => {
    if (workers == null) {
        return [];
    }
    const workersArray = Object.entries(workers).map(([k, v]) => {
        const workerId = k.match(/([^/]*)\/*$/)[0];
        return {
            id: workerId,
            algorithmName: v.algorithmName,
            workerStatus: v.workerStatus,
            workerPaused: !!v.workerPaused,
            hotWorker: v.hotWorker,
            podName: v.podName
        };
    });
    return workersArray;
};

const normalizeHotWorkers = (algorithmRequests, algorithmTemplateStore) => {
    const requests = [];
    const normRequests = algorithmRequests || [];
    const algorithmTemplates = algorithmTemplateStore || {};
    const groupNormRequests = groupBy(normRequests, 'algorithmName');
    Object.entries(algorithmTemplates).filter(([, v]) => v.minHotWorkers > 0).forEach(([k, v]) => {
        const groupNor = groupNormRequests[k];
        const requestsPerAlgorithm = (groupNor && groupNor.length) || 0;
        if (requestsPerAlgorithm < v.minHotWorkers) {
            const desired = v.minHotWorkers - requestsPerAlgorithm;
            const array = new Array(desired).fill({ algorithmName: k, hotWorker: true });
            requests.push(...array);
        }
    });
    return requests;
};


/**
 * find workers that should transform from hot to cold by calculating 
 * the diff between the current hot workers and desired hot workers.
 */
const normalizeColdWorkers = (normWorkers, hotWorkers) => {
    const coldWorkers = [];
    if (!Array.isArray(normWorkers) || normWorkers.length === 0) {
        return coldWorkers;
    }
    const normHotWorkers = normWorkers.filter(w => w.hotWorker);
    const groupNorWorkers = groupBy(normHotWorkers, 'algorithmName');
    const groupHotWorkers = groupBy(hotWorkers, 'algorithmName');
    Object.entries(groupNorWorkers).forEach(([k, v]) => {
        const groupHot = groupHotWorkers[k];
        const countHot = (groupHot && groupHot.length) || 0;
        const countNor = v.length;

        const countDiff = countNor - countHot;
        if (countDiff > 0) {
            const array = v.slice(0, countDiff);
            coldWorkers.push(...array);
        }
    });
    return coldWorkers;
};

const normalizeDrivers = (drivers) => {
    if (drivers == null) {
        return [];
    }
    const driversArray = Object.entries(drivers).map(([k, v]) => {
        const driverId = k.match(/([^/]*)\/*$/)[0];
        return {
            id: driverId,
            driverStatus: v.driverStatus,
            paused: !!v.paused,
            podName: v.podName
        };
    });
    return driversArray;
};

const calcRatioFree = (node) => {
    node.ratio = {
        cpu: node.requests.cpu / node.total.cpu,
        gpu: (node.total.gpu && node.requests.gpu / node.total.gpu) || 0,
        memory: node.requests.memory / node.total.memory
    };
    node.free = {
        cpu: node.total.cpu - node.requests.cpu,
        gpu: node.total.gpu - node.requests.gpu,
        memory: node.total.memory - node.requests.memory
    };
};

const _nodeTaintsFilter = (node) => {
    return !(node.spec && node.spec.taints && node.spec.taints.some(t => t.effect === 'NoSchedule'));
};

const parseGpu = (gpu) => {
    return gpu && gpu[gpuVendors.NVIDIA] && parseInt(gpu[gpuVendors.NVIDIA], 10);
};

const normalizeResources = ({ pods, nodes } = {}) => {
    if (!pods || !nodes) {
        return {
            allNodes: {
                ratio: {
                    cpu: 0,
                    gpu: 0,
                    memory: 0,
                },
                free: {
                    cpu: 0,
                    gpu: 0,
                    memory: 0
                }
            }
        };
    }
    const initial = nodes.body.items.filter(_nodeTaintsFilter).reduce((acc, cur) => {
        acc[cur.metadata.name] = {
            labels: cur.metadata.labels,
            requests: { cpu: 0, gpu: 0, memory: 0 },
            limits: { cpu: 0, gpu: 0, memory: 0 },
            total: {
                cpu: parse.getCpuInCore(cur.status.allocatable.cpu),
                gpu: parseGpu(cur.status.allocatable) || 0,
                memory: parse.getMemoryInMi(cur.status.allocatable.memory)
            }
        };
        return acc;
    }, {});
    const allNodes = {
        requests: { cpu: 0, gpu: 0, memory: 0 },
        limits: { cpu: 0, gpu: 0, memory: 0 },
        total: {
            cpu: sumBy(Object.values(initial), 'total.cpu'),
            gpu: sumBy(Object.values(initial), 'total.gpu'),
            memory: sumBy(Object.values(initial), 'total.memory'),
        }
    };
    const stateFilter = p => p.status.phase === 'Running' || p.status.phase === 'Pending';
    const resourcesPerNode = pods.body.items.filter(stateFilter).reduce((accumulator, pod) => {
        const { nodeName } = pod.spec;
        if (!nodeName || !accumulator[nodeName]) {
            return accumulator;
        }
        const requestCpu = sumBy(pod.spec.containers, c => parse.getCpuInCore(objectPath.get(c, 'resources.requests.cpu', '0m')));
        const requestGpu = sumBy(pod.spec.containers, c => parseGpu(objectPath.get(c, 'resources.requests.gpu', 0)));
        const requestMem = sumBy(pod.spec.containers, c => parse.getMemoryInMi(objectPath.get(c, 'resources.requests.memory', 0)));
        const limitsCpu = sumBy(pod.spec.containers, c => parse.getCpuInCore(objectPath.get(c, 'resources.limits.cpu', '0m')));
        const limitsGpu = sumBy(pod.spec.containers, c => parseGpu(objectPath.get(c, 'resources.limits.gpu', 0)));
        const limitsMem = sumBy(pod.spec.containers, c => parse.getMemoryInMi(objectPath.get(c, 'resources.limits.memory', 0)));

        accumulator[nodeName].requests.cpu += requestCpu;
        accumulator[nodeName].requests.gpu += requestGpu;
        accumulator[nodeName].requests.memory += requestMem;
        accumulator[nodeName].limits.cpu += limitsCpu;
        accumulator[nodeName].limits.gpu += limitsGpu;
        accumulator[nodeName].limits.memory += limitsMem;
        return accumulator;
    }, initial);

    const nodeList = [];
    Object.entries(resourcesPerNode).forEach(([k, v]) => {
        calcRatioFree(v);
        allNodes.requests.cpu += v.requests.cpu;
        allNodes.requests.gpu += v.requests.gpu;
        allNodes.requests.memory += v.requests.memory;
        allNodes.limits.cpu += v.limits.cpu;
        allNodes.limits.gpu += v.limits.gpu;
        allNodes.limits.memory += v.limits.memory;
        nodeList.push({ name: k, ...v });
    });
    calcRatioFree(allNodes);
    return { allNodes, nodeList };
};

const normalizeRequests = (requests) => {
    if (requests == null || requests.length === 0 || requests[0].data == null) {
        return [];
    }

    return requests[0].data.map(r => ({ algorithmName: r.name }));
};

const normalizeDriversRequests = (requests) => {
    if (requests == null || requests.length === 0 || requests[0].data == null) {
        return [];
    }
    return [{
        name: 'pipeline-driver',
        pods: requests[0].data.filter(r => r.name === 'pipeline-driver').length
    }];
};

const _tryParseTime = (timeString) => {
    if (!timeString) {
        return null;
    }
    try {
        const date = new Date(timeString);
        return date.getTime();
    }
    catch (error) {
        return null;
    }
};

const normalizeJobs = (jobsRaw, predicate = () => true) => {
    if (!jobsRaw || !jobsRaw.body || !jobsRaw.body.items) {
        return [];
    }
    const jobs = jobsRaw.body.items
        .filter(predicate)
        .map(j => ({
            name: j.metadata.name,
            algorithmName: j.metadata.labels['algorithm-name'],
            active: j.status.active === 1,
            startTime: _tryParseTime(j.status.startTime)
        }));
    return jobs;
};

const normalizeDriversJobs = (jobsRaw, predicate = () => true) => {
    if (!jobsRaw || !jobsRaw.body || !jobsRaw.body.items) {
        return [];
    }
    const jobs = jobsRaw.body.items
        .filter(predicate)
        .map(j => ({
            name: j.metadata.name,
            active: j.status.active === 1
        }));
    return jobs;
};

const mergeWorkers = (workers, jobs) => {
    const foundJobs = [];
    const mergedWorkers = workers.map((w) => {
        const jobForWorker = jobs.find(j => w.podName && w.podName.startsWith(j.name));
        if (jobForWorker) {
            foundJobs.push(jobForWorker.name);
        }
        return { ...w, job: jobForWorker ? { ...jobForWorker } : undefined };
    });

    const extraJobs = jobs.filter((job) => {
        return !foundJobs.find(j => j === job.name);
    });
    return { mergedWorkers, extraJobs };
};

const normalizeDriversAmount = (jobs, requests, settings) => {
    const { minAmount, maxAmount, name } = settings;
    let amount = minAmount;
    const request = requests[0] || {};

    if (request.pods > minAmount) {
        amount = maxAmount;
    }
    const missingDrivers = amount - jobs.length;
    return { name, pods: missingDrivers };
};

module.exports = {
    normalizeWorkers,
    normalizeHotWorkers,
    normalizeColdWorkers,
    normalizeDrivers,
    normalizeRequests,
    normalizeDriversRequests,
    normalizeJobs,
    normalizeDriversJobs,
    mergeWorkers,
    normalizeResources,
    normalizeDriversAmount
};
