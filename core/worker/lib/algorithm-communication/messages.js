module.exports = {
    incomming: {
        initialized: 'initialized',
        started: 'started',
        stopped: 'stopped',
        progress: 'progress',
        error: 'errorMessage',
        servingStatus: 'servingStatus',
        startRawSubPipeline: 'startRawSubPipeline',
        startStoredSubPipeline: 'startStoredSubPipeline',
        stopSubPipeline: 'stopSubPipeline',
        startSpan: 'startSpan',
        finishSpan: 'finishSpan',
        startAlgorithmExecution: 'startAlgorithmExecution',
        stopAlgorithmExecution: 'stopAlgorithmExecution',
        streamingStatistics: 'streamingStatistics',
        storing: 'storing',
        done: 'done'
    },
    outgoing: {
        initialize: 'initialize',
        start: 'start',
        cleanup: 'cleanup',
        stop: 'stop',
        exit: 'exit',
        serviceDiscoveryUpdate: 'serviceDiscoveryUpdate',
        subPipelineStarted: 'subPipelineStarted',
        subPipelineError: 'subPipelineError',
        subPipelineDone: 'subPipelineDone',
        subPipelineStopped: 'subPipelineStopped',
        execAlgorithmError: 'algorithmExecutionError',
        execAlgorithmDone: 'algorithmExecutionDone'
    }
};
