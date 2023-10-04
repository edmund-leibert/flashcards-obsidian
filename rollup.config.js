import typescript from '@rollup/plugin-typescript';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import svg from "rollup-plugin-svg";

const PRODUCTION_PLUGIN_CONFIG = {
  input: 'main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    sourcemapExcludeSources: true,
    format: 'cjs',
    exports: 'default'
  },
  external: ['obsidian'],
  plugins: [
    typescript(),
    nodeResolve({browser: true}),
    commonjs(),
    svg()
  ]
};

const DEV_PLUGIN_CONFIG = {
  input: 'main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    format: 'cjs',
    exports: 'default'
  },
  external: ['obsidian'],
  plugins: [
    typescript(),
    nodeResolve({browser: true}),
    commonjs(),
    svg()
  ]
};

let configs = []

// eslint-disable-next-line no-undef
const pluginConfig = process.env.BUILD === "production" ? PRODUCTION_PLUGIN_CONFIG : DEV_PLUGIN_CONFIG;
configs.push(pluginConfig);

export default configs;