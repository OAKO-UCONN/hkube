const { NodesMap } = require('@hkube/dag');
const Etcd = require('@hkube/etcd');
const { parser, consts } = require('@hkube/parsers');
const { relations } = consts;

class Runner {
    async init(options) {
        this._options = options;
        this._etcd = new Etcd(options.etcd);
        await this._etcd.jobs.status.watch({ jobId: 'hookWatch' });
    }

    async parse(jobId, nodeName) {
        const pipeline = await this._getStoredExecution(jobId);
        this._validateType(pipeline.nodes);
        const { successors } = this._findRelations(pipeline, nodeName);
        const subPipeline = this._createSubPipeline(pipeline, nodeName, successors);
        return subPipeline;
    }

    _validateType(nodes) {
        const node = nodes.find(n => parser.findNodeRelation(n.input, relations.WAIT_ANY));
        if (node) {
            throw new Error(`relation ${relations.WAIT_ANY} for node ${node.nodeName} is not allowed`);
        }
    }

    _createSubPipeline(pipeline, nodeName, successors) {
        const nodes = [];
        pipeline.nodes.forEach((n) => {
            if (n.nodeName === nodeName) {
                n.cacheJobId = pipeline.rootJobId || pipeline.jobId; //eslint-disable-line
            }
            if (successors.includes(n.nodeName)) {
                nodes.push(n);
            }
        });
        return { ...pipeline, nodes };
    }

    _flatten(nodes, nodeName) {
        const flatten = new Set();
        flatten.add(nodeName);
        if (nodes) {
            nodes.forEach((n) => {
                if (!flatten.has(n)) {
                    flatten.add(n);
                }
            });
        }
        return [...flatten];
    }

    async _getStoredExecution(jobId) {
        const pipeline = await this._etcd.executions.stored.get({ jobId });
        if (!pipeline) {
            throw new Error(`unable to find pipeline ${jobId}`);
        }
        return pipeline;
    }

    _findRelations(pipeline, nodeName) {
        const graph = new NodesMap({ nodes: pipeline.nodes });
        const successorsMap = this._getSuccessors(graph, nodeName);
        const successors = this._flatten(successorsMap, nodeName);
        return { successors };
    }

    _getSuccessors(graph, nodeName, res = []) {
        const successors = graph._childs(nodeName);
        if (!successors) {
            throw new Error(`cant find relations for ${nodeName}`);
        }
        if (successors.length === 0) {
            return null;
        }
        res.push(...successors);
        successors.forEach(p => this._getSuccessors(graph, p, res));
        return res;
    }
}

module.exports = new Runner();
