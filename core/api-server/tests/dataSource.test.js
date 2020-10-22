const { expect } = require('chai');
const fse = require('fs-extra');
const HttpStatus = require('http-status-codes');
const { uid: uuid } = require('@hkube/uid');
const stateManager = require('../lib/state/state-manager');
const validationMessages = require('../lib/consts/validationMessages.js');
const { MESSAGES } = require('../lib/consts/builds');
const { request, delay, defaultProps } = require('./utils');
let restUrl, restPath;

/** @type {(props?: {
 * body?: {
 *      name?:string
 * }, 
 * withFile?:boolean,
 * uri?: string
 * }) => Promise<any>} */
const createDataSource = ({
    body = {},
    withFile = true,
    uri = restPath,
} = {}) => {
    const formData = {
        ...body,
        file: withFile ? fse.createReadStream('tests/mocks/algorithm.tar') : undefined
    };
    const options = {
        uri,
        formData
    };
    return request(options);
};

describe.only('Datasource', () => {
    before(() => {
        restUrl = global.testParams.restUrl;
        restPath = `${restUrl}/datasource`;
    });
    describe.skip('/datasource/:id GET', () => {
        it('should throw error datasource not found', async () => {
            const options = {
                uri: restPath + '/not_exists',
                method: 'GET'
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.NOT_FOUND);
            expect(response.body.error.message).to.equal('algorithm not_exists Not Found');
        });
        it('should return specific datasource', async () => {
            const body = {
                name: "test-alg",
                algorithmImage: "hkube/algorithm-example",
                cpu: 1,
                mem: "5000Ki"
            };
            const options = {
                uri: restPath,
                body
            };
            await request(options);

            const getOptions = {
                uri: restPath + '/test-alg',
                method: 'GET'
            };
            const response = await request(getOptions);
            expect(response.body).to.deep.equal({
                ...defaultProps,
                ...body
            });
        });
    });
    describe.skip('/datasource/:id DELETE', () => {
        it('should throw error algorithm not found', async () => {
            const algorithmName = `delete-${uuid()}`;
            const options = {
                uri: `${restPath}/${algorithmName}`,
                method: 'DELETE'
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.NOT_FOUND);
            expect(response.body.error.message).to.equal(`algorithm ${algorithmName} Not Found`);
        });
        it('should throw error on related data', async () => {
            const algorithmName = `delete-${uuid()}`;
            const algorithm = {
                uri: restPath,
                body: {
                    name: algorithmName,
                    algorithmImage: "image"
                }
            };
            const store = {
                uri: `${restUrl}/store/pipelines`,
                body: {
                    name: `delete-${uuid()}`,
                    nodes: [
                        {
                            nodeName: 'green',
                            algorithmName,
                            input: []
                        }

                    ]
                }
            };
            const exec = {
                uri: `${restUrl}/exec/stored`,
                body: {
                    name: store.body.name
                }
            };

            const resAlg = await request(algorithm);
            await request(store);
            await request(exec);
            await stateManager.algorithms.versions.set(resAlg.body);
            await stateManager.algorithms.builds.set({ buildId: `${algorithmName}-1`, algorithmName });
            await stateManager.algorithms.builds.set({ buildId: `${algorithmName}-2`, algorithmName });

            const optionsDelete = {
                uri: `${restPath}/${algorithmName}?force=false`,
                method: 'DELETE'
            };
            const response = await request(optionsDelete);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.contain('you must first delete all related data');
        });
        it('should delete datasource with related data with force', async () => {
            const algorithmName = `my-alg-${uuid()}`;
            const algorithmImage = `${algorithmName}-image`;
            const formData = {
                payload: JSON.stringify({ name: algorithmName, env: 'nodejs' }),
                file: fse.createReadStream('tests/mocks/algorithm.tar.gz')
            };
            const resApply = await request({ uri: `${restPath}/apply`, formData });
            const storePipeline = {
                uri: `${restUrl}/store/pipelines`,
                body: {
                    name: `delete-${uuid()}`,
                    nodes: [
                        {
                            nodeName: 'green',
                            algorithmName,
                            input: []
                        }

                    ]
                }
            };
            const execPipeline = {
                uri: `${restUrl}/exec/stored`,
                body: {
                    name: storePipeline.body.name
                }
            };

            await request(storePipeline);
            await request(execPipeline);
            await stateManager.algorithms.versions.set({ ...resApply.body.algorithm, algorithmImage });

            const optionsDelete = {
                uri: `${restPath}/${algorithmName}?force=true`,
                method: 'DELETE'
            };
            const response = await request(optionsDelete);
            expect(response.body).to.have.property('message');
            expect(response.body.message).to.contain('related data deleted');
        });
        it('should delete specific datasource without related data', async () => {
            const optionsInsert = {
                uri: restPath,
                body: {
                    name: 'delete',
                    algorithmImage: 'image'
                }
            };
            await request(optionsInsert);

            const options = {
                uri: restPath + '/delete?force=true',
                method: 'DELETE'
            };
            const response = await request(options);
            expect(response.body).to.have.property('message');
            expect(response.body.message).to.contain('successfully deleted from store');
        });
    });
    describe.skip('/datasource GET', () => {
        it('should success to get list of datasources', async () => {
            const options = {
                uri: restPath,
                method: 'GET'
            };
            const response = await request(options);
            expect(response.body).to.be.an('array');
        });
    });
    describe('/datasource POST', () => {
        describe('validation', () => {
            it('should throw validation error of required property name', async () => {
                const response = await createDataSource();
                expect(response.body).to.have.property('error');
                expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
                expect(response.body.error.message).to.equal("data should have required property 'name'");
            });
            it('should throw validation error of long datasource name', async () => {
                const response = await createDataSource({
                    body: {
                        name: 'this-is-33-length-algorithm--name'
                    }
                });
                expect(response.body).to.have.property('error');
                expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
                expect(response.body.error.message).to.equal("data.name should NOT be longer than 32 characters");
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
            it('should throw missing file error', async () => {
                const options = {
                    uri: restPath,
                    body: {
                        name: 'my-dataSource',
                    }
                };
                const response = await request(options);
                expect(response.body).to.have.property('error');
                expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
                expect(response.body.error.message).to.equal('no file was submitted');
            });
            const invalidChars = ['/', '*', '#', '"', '%'];
            invalidChars.forEach((v) => {
                it(`should throw invalid dataSource name if include ${v}`, async () => {
                    const response = await createDataSource({ body: { name: `not-valid${v}name` } });
                    expect(response.body).to.have.property('error');
                    expect(response.response.statusCode).to.equal(HttpStatus.BAD_REQUEST);
                    expect(response.body.error.message).to.equal(validationMessages.DATASOURCE_NAME_FORMAT);
                });
            });
            const invalidStartAndEndChars = ['/', '*', '#', '"', '%'];
            invalidStartAndEndChars.forEach((v) => {
                it(`should throw invalid if dataSource name if start with ${v}`, async () => {
                    const response = await createDataSource({ body: { name: `${v}notvalidname` } });
                    expect(response.body).to.have.property('error');
                    expect(response.response.statusCode).to.equal(HttpStatus.BAD_REQUEST);
                    expect(response.body.error.message).to.equal(validationMessages.DATASOURCE_NAME_FORMAT);
                });
                it(`should throw invalid if dataSource name if end with ${v}`, async () => {
                    const response = await createDataSource({ body: { name: `notvalidname${v}` } });
                    expect(response.body).to.have.property('error');
                    expect(response.response.statusCode).to.equal(HttpStatus.BAD_REQUEST);
                    expect(response.body.error.message).to.equal(validationMessages.DATASOURCE_NAME_FORMAT);
                });
            });
        });
        describe('create', () => {
            it("should create a new dataSource and return it's newly created id", async () => {
                const name = uuid();
                const { response } = await createDataSource({ body: { name } });
                expect(response.statusCode).to.eql(201);
                expect(response.body).to.have.property('id');
                expect(response.body).to.have.property('name');
                expect(response.body.id).to.be.string;
                expect(response.body.name).to.eq(name);
            });
            it('should throw conflict error', async () => {
                const name = uuid();
                const firstResponse = await createDataSource({ body: { name } });
                expect(firstResponse.response.statusCode).to.eql(201);
                const secondResponse = await createDataSource({ body: { name } });
                expect(secondResponse.response.statusCode).to.equal(409);
                expect(secondResponse.body).to.have.property('error');
                expect(secondResponse.body.error.message).to.contain('already exists');
            });
        });
    });
    describe.skip('/datasource/:id PUT', () => {
        it('should throw validation error of memory min 4 Mi', async () => {
            const body = Object.assign({}, algorithms[0]);
            body.mem = '3900Ki';
            const options = {
                method: 'PUT',
                uri: restPath,
                body
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('memory must be at least 4 Mi');
        });
        it('should succeed to update algorithm', async () => {
            const body = { ...algorithms[0] };
            const options = {
                uri: restPath,
                method: 'PUT',
                body
            };
            const response = await request(options);
            expect(response.body).to.eql({ ...defaultProps, ...body });
        });
        it('should failed to update algorithm', async () => {
            const body = { ...algorithms[0], algorithmImage: '' };
            const options = {
                uri: restPath,
                method: 'PUT',
                body
            };
            const response = await request(options);
            expect(response.body).to.have.property('error');
            expect(response.body.error.code).to.equal(HttpStatus.BAD_REQUEST);
            expect(response.body.error.message).to.equal('cannot apply algorithm due to missing image url or build data');
        });
        it('should succeed to update algorithm', async () => {
            const body = { ...algorithms[0], algorithmImage: 'new-image' };
            const options = {
                uri: restPath,
                method: 'PUT',
                body
            };
            const response = await request(options);
            expect(response.body).to.eql({ ...defaultProps, ...body });
        });
    });
});
