const clonedeep = require('lodash.clonedeep');
const log = require('@hkube/logger').GetLogFromContainer();
const { applyEnvToContainer, applyStorage } = require('@hkube/kubernetes-client').utils;
const { applyImage } = require('../helpers/kubernetes-utils');
const component = require('../consts/componentNames').K8S;
const { deploymentBoardTemplate, boardIngress, boardService } = require('../templates/tensorboard');
const CONTAINERS = require('../consts/containers');


const applyNodeSelector = (inputSpec, clusterOptions = {}) => {
    const spec = clonedeep(inputSpec);
    if (!clusterOptions.useNodeSelector) {
        delete spec.spec.template.spec.nodeSelector;
    }
    return spec;
};

const createKindsSpec = ({ boardId, logDir, versions, registry, clusterOptions }) => {
    if (!boardId) {
        const msg = 'Unable to create deployment spec. boardId is required';
        log.error(msg, { component });
        throw new Error(msg);
    }
    const deployment = deploymentBoardTemplate(boardId);
    let deploymentSpec = clonedeep(deployment);
    deploymentSpec = applyNodeSelector(deploymentSpec, clusterOptions);
    deploymentSpec = applyEnvToContainer(deploymentSpec, CONTAINERS.TENSORBOARD, { logDir });
    deploymentSpec = applyImage(deploymentSpec, CONTAINERS.TENSORBOARD, versions, registry);
    deploymentSpec = applyStorage(deploymentSpec, 's3', CONTAINERS.TENSORBOARD, 'algorithm-operator-configmap');
    const ingressSpec = boardIngress(boardId, clusterOptions);
    const serviceSpec = boardService(boardId);
    return {
        deploymentSpec,
        ingressSpec,
        serviceSpec
    };
};

module.exports = {
    createKindsSpec
};