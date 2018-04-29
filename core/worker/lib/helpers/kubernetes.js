const EventEmitter = require('events');
const Logger = require('@hkube/logger');
const kubernetesClient = require('kubernetes-client');
const objectPath = require('object-path');
const component = require('../../common/consts/componentNames').K8S;
let log;

class KubernetesApi extends EventEmitter {
    async init(options = {}) {
        const k8sOptions = options.kubernetes || {};
        log = Logger.GetLogFromContainer();
        let config;
        if (!k8sOptions.isLocal) {
            try {
                config = kubernetesClient.config.fromKubeconfig();
            }
            catch (error) {
                log.error(`Error initializing kubernetes. error: ${error.message}`, { component }, error);
                return;
            }
        }
        else {
            config = kubernetesClient.config.getInCluster();
        }
        log.info(`Initialized kubernetes client with options ${JSON.stringify({ options: options.kubernetes, url: config.url })}`, { component });
        this._client = new kubernetesClient.Client({ config, version: '1.9' });
        this._namespace = k8sOptions.namespace;
    }

    async getJobForPod(podName) {
        try {
            log.debug(`getJobForPod for pod ${podName}`, { component });
            const pod = await this._client.api.v1.namespaces(this._namespace).pods(podName).get();
            return objectPath.get(pod, 'body.metadata.labels.job-name');
        }
        catch (error) {
            log.error(`unable to get pod details ${podName}. error: ${error.message}`, { component }, error);
            return null;
        }
    }

    async deleteJob(jobName) {
        log.debug(`Deleting job ${jobName}`, { component });
        try {
            const res = await this._client.apis.batch.v1.namespaces(this._namespace).jobs(jobName).delete({ body: { propagationPolicy: 'Foreground' } });
            return res;
        }
        catch (error) {
            log.error(`unable to delete job ${jobName}. error: ${error.message}`, { component }, error);
        }
        return null;
    }
}

module.exports = new KubernetesApi();
