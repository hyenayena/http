import type {ModulePlugin} from '../../../src/api.js';
import {createCommand} from './commands.js';

const plugin: ModulePlugin = () => [createCommand()];

export default plugin;
