const { expect } = require('chai');
const HttpStatus = require('http-status-codes');
const { pipelineTypes } = require('@hkube/consts');
const nock = require('nock');
const { request } = require('./utils');
const validationMessages = require('../lib/consts/validationMessages.js');
const pipelines = require('./mocks/pipelines.json');
const { cachingError } = require('./mocks/http-response.json');
let restUrl, jobId, config;

const flowInputMetadata = {
    metadata: {
        'flowInput.files.link': {
            "type": "string"
        },
        'storageInfo': {
            "path": "local-hkube/main:3b"

        }
    }
}

describe('Executions', () => {
    before(() => {
        restUrl = global.testParams.restUrl;
        config = global.testParams.config;
    });
    describe('/exec/caching', () => {
        let restPath = null;
        before(async () => {
            restPath = `${restUrl}/exec/caching`;
            const runRawPath = `${restUrl}/exec/raw`;
            const pipeline = pipelines.find((pl) => pl.name === 'flow1')
            const options = {
                uri: runRawPath,
                body: pipeline
            };
            const response = await request(options);
            jobId = response.body.jobId;
            const { protocol, host, port, prefix } = config.cachingServer;
            const cachingServiceURI = `${protocol}://${host}:${port}`;
            let pathToJob = `/${prefix}?jobId=${jobId}&nodeName=black-alg`;
            nock(cachingServiceURI).persist().get(pathToJob).reply(200, { ...pipeline, jobId, rootJobId: jobId, flowInputMetadata });
            pathToJob = `/${prefix}?jobId=stam-job&nodeName=stam-alg`;
            nock(cachingServiceURI).persist().get(pathToJob).reply(400, cachingError);

        });
        it('should succeed run caching', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId,
                    nodeName: 'black-alg'
                }
            };
            const response = await request(options);
            expect(response.body).not.to.have.property('error');
            expect(response.body).to.have.property('jobId');
        });
        it('should fail on no jobId', async () => {
            const options = {
                uri: restPath,
                body: {
                    nodeName: 'black-alg'
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal("data should have required property 'jobId'");
        });
        it('should fail on additional property', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId,
                    nodeName: 'black-alg',
                    stam: 'klum'
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('data should NOT have additional properties (stam)');
        });
        it('should fail on no such node or job', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId: 'stam-job',
                    nodeName: 'stam-alg'
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal("part of the data is missing or incorrect error:cant find successors for stam-alg");
        });
        it('should succeed to execute with right types', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId,
                    nodeName: 'black-alg'
                }
            };
            const res1 = await request(options);
            const optionsGET = {
                uri: `${restUrl}/exec/pipelines/${res1.body.jobId}`,
                method: 'GET'
            };
            const res2 = await request(optionsGET);
            expect(res2.body.types).to.eql([pipelineTypes.NODE]);
        });
        it('should succeed to execute with right flowInputMetadata', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId,
                    nodeName: 'black-alg'
                }
            };
            const res1 = await request(options);
            const optionsGET = {
                uri: `${restUrl}/exec/pipelines/${res1.body.jobId}`,
                method: 'GET'
            };
            const res2 = await request(optionsGET);
            expect(res2.body.flowInputMetadata).to.eql(flowInputMetadata);
        });
        it('should succeed to save the rootJobId', async () => {
            const options = {
                uri: restPath,
                body: {
                    jobId,
                    nodeName: 'black-alg'
                }
            };
            await request(options);
            await request(options);
            const res1 = await request(options);
            const optionsGET = {
                uri: `${restUrl}/exec/pipelines/${res1.body.jobId}`,
                method: 'GET'
            };
            const res2 = await request(optionsGET);
            expect(res2.body.rootJobId).to.eql(jobId);
        });
    });
    describe('/exec/raw', () => {
        let restPath = null;
        before(() => {
            restPath = `${restUrl}/exec/raw`;
        });
        it('should throw validation error of required property name', async () => {
            const options = {
                uri: restPath,
                body: {}
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal("data should have required property 'name'");
        });
        it('should throw validation error of data.name should be string', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: {}
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('data.name should be string');
        });
        it('should throw validation error of name should NOT be shorter than 1 characters"', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: ''
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('data.name should NOT be shorter than 1 characters');
        });
        it('should throw validation error of required property nodes', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string'
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal("data should have required property 'nodes'");
        });
        it('should throw validation error of required property nodes.nodeName', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [
                        {
                            algorithmName: 'green-alg',
                            input: [
                                {}
                            ]
                        }
                    ]
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.eql("data.nodes[0] should have required property 'nodeName'");
        });
        it('should throw validation error of required property nodes.algorithmName', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [{
                        nodeName: 'string'
                    }]
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.contain("please provide algorithmName or pipelineName");
        });
        it('should throw validation error of nodes.input should be array', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg',
                            input: null
                        }
                    ]
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
        });
        it('should throw validation error of data should NOT have additional properties', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg',
                            input: []
                        }
                    ],
                    additionalProps: {
                        bla: 60,
                        blabla: 'info'
                    }
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('data should NOT have additional properties (additionalProps)');
        });
        it('should throw validation error of duplicate node', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [
                        {
                            nodeName: 'dup',
                            algorithmName: 'green-alg',
                            input: []
                        },
                        {
                            nodeName: 'dup',
                            algorithmName: 'green-alg',
                            input: []
                        }
                    ]
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('found duplicate node dup');
        });
        it('should throw validation error priority range', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'string',
                    nodes: [
                        {
                            nodeName: 'dup',
                            algorithmName: 'green-alg',
                            input: []
                        }
                    ],
                    priority: 8
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('data.priority should be <= 5');
        });
        const invalidStartAndEndChars = ['/', '*', '#', '"', '%'];
        invalidStartAndEndChars.forEach((v) => {
            it(`should throw validation error pipeline name include ${v}`, async () => {
                const options = {
                    uri: restPath,
                    body: {
                        name: `exec${v}raw`,
                        nodes: [
                            {
                                nodeName: 'string',
                                algorithmName: 'green-alg',
                                input: []
                            }
                        ]
                    }
                };
                const response = await request(options);
                expect(response.body).to.have.property('error');
                expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
                expect(response.body.error.message).to.equal(validationMessages.PIPELINE_NAME_FORMAT);
            });
            it(`should throw validation error pipeline name start with ${v}`, async () => {
                const options = {
                    uri: restPath,
                    body: {
                        name: `${v}xecraw`,
                        nodes: [
                            {
                                nodeName: 'string',
                                algorithmName: 'green-alg',
                                input: []
                            }
                        ]
                    }
                };
                const response = await request(options);
                expect(response.body).to.have.property('error');
                expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
                expect(response.body.error.message).to.equal(validationMessages.PIPELINE_NAME_FORMAT);
            });
        });
        it('should throw missing image for algorithm', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'no-image-pipe',
                    nodes: [
                        {
                            "nodeName": "green",
                            "algorithmName": "eval-alg",
                            "input": [
                                "data"
                            ]
                        },
                        {
                            "nodeName": "yellow",
                            "algorithmName": "no-image-alg",
                            "input": [
                                "@green"
                            ]
                        }
                    ]

                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('missing image for algorithm no-image-alg');
        });
        it('should not throw missing image for debug algorithm', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'no-image-pipe',
                    nodes: [
                        {
                            "nodeName": "green",
                            "algorithmName": "eval-alg",
                            "input": [
                                "data"
                            ]
                        },
                        {
                            "nodeName": "yellow",
                            "algorithmName": "no-image-alg-debug",
                            "input": [
                                "@green"
                            ]
                        }
                    ]

                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('jobId');
        });
        it('should succeed and return job id', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'exec_raw',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg',
                            input: [],
                            "metrics": {
                                "tensorboard": true
                            }
                        }
                    ]
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('jobId');
        });
        it('should succeed to run with null flowInput', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'exec_raw',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg',
                            input: ["@flowInput.inputs"]
                        }
                    ],
                    flowInput: {
                        inputs: null
                    }
                }
            };
            const response = await request(options);
            expect(response.body).to.have.property('jobId');
        });
        it('should succeed to execute with right types', async () => {
            const options = {
                uri: restPath,
                body: {
                    name: 'exec_raw',
                    nodes: [
                        {
                            nodeName: 'string',
                            algorithmName: 'green-alg',
                            input: []
                        }
                    ]
                }
            };
            const res1 = await request(options);
            const optionsGET = {
                uri: `${restUrl}/exec/pipelines/${res1.body.jobId}`,
                method: 'GET'
            };
            const res2 = await request(optionsGET);
            expect(res2.body.types).to.eql([pipelineTypes.RAW]);
        });
    });
});
