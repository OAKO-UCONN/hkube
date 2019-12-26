
const orderBy = require('lodash.orderby');
const storageManager = require('@hkube/storage-manager');
const validator = require('../validation/api-validator');

class StorageService {
    init(config) {
        this.config = config;
    }

    getInfo() {
        return {
            storage: this.config.defaultStorage,
        };
    }

    get prefixesTypes() {
        return storageManager.prefixesTypes;
    }

    async getPrefixesByPath({ path, ...options }) {
        validator.validateListRange(options);
        return this._getPrefixesByPath({ path, ...options });
    }

    async _getPrefixesByPath({ path, sort, order, from, to }) {
        const keys = await storageManager.storage.listPrefixes({ path });
        const result = this._formatResponse({ path, keys, sort, order, from, to });
        return result;
    }

    async getAllPrefixes(options) {
        validator.validateListRange(options);
        return Promise.all(this.prefixesTypes.map(path => this._getPrefixesByPath({ path, ...options })));
    }

    async getKeysByPath({ path, ...options }) {
        validator.validateListRange(options);
        return this._getKeysByPath({ path, ...options });
    }

    async _getKeysByPath({ path, sort, order, from, to }) {
        const keys = await storageManager.storage.listWithStats({ path });
        return this._formatResponse({ path, keys, sort, order, from, to });
    }

    async getAllKeys(options) {
        validator.validateListRange(options);
        return Promise.all(this.prefixesTypes.map(path => this._getKeysByPath({ path, ...options })));
    }

    async getStream({ path }) {
        return storageManager.getStream({ path });
    }

    _formatResponse({ path, keys, sort, order, from, to }) {
        const orderKeys = orderBy(keys, sort, order);
        const sliceKeys = orderKeys.slice(from, to);
        return { path, total: keys.length, keys: sliceKeys };
    }

    getByPath({ path }) {
        return storageManager.storage.get({ path });
    }
}

module.exports = new StorageService();