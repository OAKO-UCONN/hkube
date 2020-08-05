const delay = require('delay');
const { expect } = require('chai');
const { uid } = require('@hkube/uid');
const stateAdapter = require('../lib/states/stateAdapter');
const autoScaler = require('../lib/streaming/auto-scaler.js');
const discovery = require('../lib/streaming/service-discovery.js');

const pipeline = {
    name: "stream",
    kind: "stream",
    nodes: [
        {
            nodeName: "A",
            algorithmName: "eval-alg",
            input: [
                "@flowInput.arraySize",
                "@flowInput.bufferSize"
            ],
            stateType: "stateful"
        },
        {
            nodeName: "D",
            algorithmName: "eval-alg",
            input: [
                "@A",
                "@flowInput.arraySize",
                "@flowInput.bufferSize"
            ],
            stateType: "stateless"
        },
        {
            nodeName: "E",
            algorithmName: "eval-alg",
            input: [
                "@A"
            ],
            stateType: "stateless"
        }
    ],
    flowInputMetadata: {
        metadata: {
            "flowInput.arraySize": {
                "type": "number"
            },
            "flowInput.bufferSize": {
                "type": "number"
            }
        },
        storageInfo: {
            "path": "local-hkube/main:streaming:9dy12jfh/main:streaming:9dy12jfh"
        }
    }
}

const streamingDiscovery = {
    host: process.env.POD_IP || '127.0.0.1',
    port: process.env.STREAMING_DISCOVERY_PORT || 9021
};

const addDiscovery = async ({ jobId, nodeName, port }) => {
    stateAdapter._etcd.discovery._client.leaser._lease = null;
    const instanceId = uid({ length: 10 });
    await stateAdapter._etcd.discovery.register({
        data: {
            jobId,
            taskId: uid(),
            nodeName,
            streamingDiscovery: { ...streamingDiscovery, port }
        },
        instanceId
    });
    return instanceId;
}

const deleteDiscovery = async ({ instanceId }) => {
    await stateAdapter._etcd.discovery.delete({ instanceId });
}

describe.only('Streaming', () => {
    describe('auto-scaler', () => {
        it('should not scale when no relevant data', async () => {
            const jobId = uid();
            const scale = async (data) => {
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D'
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            await scale(list);
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(0);
            expect(scaleDown).to.have.lengthOf(0);
        });
        it('should not over the maxSizeWindow', async () => {
            const jobId = uid();
            const nodeName = 'D';
            const data = [{
                nodeName,
                queueSize: 10
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            autoScaler.report(data);
            autoScaler.report(data);
            autoScaler.report(data);
            autoScaler.report(data);
            autoScaler.report(data);
            autoScaler.report(data);
            const { requests, responses } = autoScaler._statistics.data[nodeName];
            expect(requests).to.have.lengthOf(4);
            expect(responses).to.have.lengthOf(4);
        });
        it('should scale based on queueSize equals 1', async () => {
            const jobId = uid();
            const scale = async (data) => {
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D',
                queueSize: 1
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(2);
        });
        it('should scale and update progress', async () => {
            const jobId = uid();
            const nodeName = 'D';
            const scale = async (data) => {
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName,
                queueSize: 1
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            const progressMap = autoScaler.checkProgress();
            expect(progressMap[nodeName]).to.eql(0.5);
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(2);
        });
        it('should scale based on queueSize only', async () => {
            const jobId = uid();
            const scale = async (data) => {
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D',
                queueSize: 500,
                responses: 0
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(2);
        });
        it('should scale based on queueSize and responses only', async () => {
            const jobId = uid();
            const scale = async (data) => {
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D',
                queueSize: 500,
                responses: 100
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(5);
        });
        it('should scale max size based on queueSize only', async () => {
            const jobId = uid();
            const scale = async (data) => {
                data[0].queueSize += 10;
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D',
                queueSize: 5,
                sent: 0
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            await scale(list);
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(2);
        });
        it('should scale down based on queueSize only', async () => {
            const jobId = uid();
            const nodeName = 'D';
            const queueSizeUp = async (data) => {
                data[0].queueSize += 100;
                data[0].responses = 0;
                autoScaler.report(data);
                await delay(100);
            }
            const responsesUp = async (data) => {
                data[0].queueSize = 0;
                data[0].responses += 100;
                data[0].sent = 200;
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName,
                sent: 0,
                queueSize: 0,
                responses: 0
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await addDiscovery({ jobId, nodeName, port: 5001 });
            await addDiscovery({ jobId, nodeName, port: 5002 });
            await addDiscovery({ jobId, nodeName, port: 5003 });
            await addDiscovery({ jobId, nodeName, port: 5004 });
            await addDiscovery({ jobId, nodeName, port: 5005 });
            await discovery._checkDiscovery({ jobId, taskId: uid() });
            await queueSizeUp(list);
            await queueSizeUp(list);
            const jobs1 = autoScaler.autoScale();
            await responsesUp(list);
            await responsesUp(list);
            const jobs2 = autoScaler.autoScale();
            expect(jobs1.scaleUp).to.have.lengthOf(1);
            expect(jobs1.scaleUp[0].replicas).to.eql(10);
            expect(jobs2.scaleDown).to.have.lengthOf(1);
            expect(jobs2.scaleDown[0].replicas).to.eql(2);
        });
        it('should scale based on request rate', async () => {
            const jobId = uid();
            const scale = async (data) => {
                data[0].sent += 10;
                autoScaler.report(data);
                await delay(100);
            }
            const list = [{
                nodeName: 'D',
                sent: 10,
                queueSize: 0
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            await scale(list);
            const { scaleUp, scaleDown } = autoScaler.autoScale();
            expect(scaleUp).to.have.lengthOf(1);
            expect(scaleDown).to.have.lengthOf(0);
            expect(scaleUp[0].replicas).to.eql(2);
        });
        it('should scale only up based on req/res rate', async () => {
            const jobId = uid();
            const scale = async (data) => {
                data[0].sent += 10;
                data[0].responses += 3;
                autoScaler.report(data);
                await delay(100);
            }
            const increaseSize = (data) => {
                data[0].responses += 1;
                data[0].currentSize += 2;
                autoScaler.report(data);
            }
            const list = [{
                nodeName: 'D',
                sent: 10,
                queueSize: 0,
                currentSize: 0,
                responses: 3
            }];
            await stateAdapter._etcd.executions.running.set({ ...pipeline, jobId });
            await autoScaler.start({ jobId, taskId: uid() });
            await scale(list);
            await scale(list);
            const jobs1 = autoScaler.autoScale();
            increaseSize(list);
            const jobs2 = autoScaler.autoScale();
            increaseSize(list);
            const jobs3 = autoScaler.autoScale();
            await scale(list);
            await scale(list);
            const jobs4 = autoScaler.autoScale();
            const jobs5 = autoScaler.autoScale();
            const jobs6 = autoScaler.autoScale();
            expect(jobs1.scaleUp).to.have.lengthOf(1);
            expect(jobs2.scaleUp).to.have.lengthOf(0);
            expect(jobs3.scaleUp).to.have.lengthOf(0);
            expect(jobs4.scaleUp).to.have.lengthOf(1);
            expect(jobs5.scaleUp).to.have.lengthOf(0);
            expect(jobs6.scaleUp).to.have.lengthOf(0);
            expect(jobs1.scaleUp[0].replicas).to.eql(4);
            expect(jobs4.scaleUp[0].replicas).to.eql(12);
            expect(jobs1.scaleDown).to.have.lengthOf(0);
            expect(jobs2.scaleDown).to.have.lengthOf(0);
            expect(jobs3.scaleDown).to.have.lengthOf(0);
            expect(jobs4.scaleDown).to.have.lengthOf(0);
            expect(jobs5.scaleDown).to.have.lengthOf(0);
            expect(jobs6.scaleDown).to.have.lengthOf(0);
        });
    });
    describe('discovery', () => {
        beforeEach(() => {
            discovery._discoveryMap = Object.create(null);
        });
        it('should add discovery and get right changes', async () => {
            const jobId = uid();
            const nodeName = uid();
            const changes1 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            await addDiscovery({ jobId, nodeName, port: 5001 });
            const changes2 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            expect(changes1).to.have.lengthOf(0);
            expect(changes2).to.have.lengthOf(1);
            expect(changes2[0].type).to.eql('Add');
            expect(changes2[0].nodeName).to.eql(nodeName);
        });
        it('should add discovery multiple times and get right changes', async () => {
            const jobId = uid();
            const nodeName1 = uid();
            const nodeName2 = uid();
            await addDiscovery({ jobId, nodeName: nodeName1, port: 5001 });
            await addDiscovery({ jobId, nodeName: nodeName2, port: 5002 });
            const changes1 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            await addDiscovery({ jobId, nodeName: nodeName1, port: 5003 });
            await addDiscovery({ jobId, nodeName: nodeName2, port: 5004 });
            const changes2 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            expect(changes1).to.have.lengthOf(2);
            expect(changes2).to.have.lengthOf(2);
            expect(changes1[0].type).to.eql('Add');
            expect(changes1[1].type).to.eql('Add');
            expect(changes1[0].nodeName).to.eql(nodeName2);
            expect(changes1[1].nodeName).to.eql(nodeName1);
            expect(changes2[0].type).to.eql('Add');
            expect(changes2[1].type).to.eql('Add');
            expect(changes2[0].nodeName).to.eql(nodeName2);
            expect(changes2[1].nodeName).to.eql(nodeName1);
        });
        it('should add and delete discovery and get right changes', async () => {
            const jobId = uid();
            const nodeName = uid();
            await addDiscovery({ jobId, nodeName, port: 5001 });
            const instanceId1 = await addDiscovery({ jobId, nodeName, port: 5002 });
            const instanceId2 = await addDiscovery({ jobId, nodeName, port: 5003 });
            const changes1 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            await deleteDiscovery({ instanceId: instanceId1 });
            await deleteDiscovery({ instanceId: instanceId2 });
            const changes2 = await discovery._checkDiscovery({ jobId, taskId: uid() });
            expect(changes1).to.have.lengthOf(3);
            expect(changes2).to.have.lengthOf(2);
            expect(changes2[0].type).to.eql('Del');
            expect(changes2[1].type).to.eql('Del');
        });
        it('should add discovery and get right changes', async () => {
            const jobId = uid();
            const nodeName1 = uid();
            const nodeName2 = uid();
            await addDiscovery({ jobId, nodeName: nodeName1, port: 5001 });
            await addDiscovery({ jobId, nodeName: nodeName1, port: 5002 });
            await addDiscovery({ jobId, nodeName: nodeName2, port: 5003 });
            await addDiscovery({ jobId, nodeName: nodeName2, port: 5004 });
            await discovery._checkDiscovery({ jobId, taskId: uid() });
            const count1 = discovery.countInstances(nodeName1);
            const count2 = discovery.countInstances(nodeName2);
            expect(count1).to.eql(2);
            expect(count2).to.eql(2);
        });
    });
});