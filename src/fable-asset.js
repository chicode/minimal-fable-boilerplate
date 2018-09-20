// @ts-check

const walk = require('babylon-walk')
const fableUtils = require('fable-utils')
const path = require('path')
const { Asset } = require('parcel-bundler')

const localRequire = require('parcel-bundler/src/utils/localRequire')
const collectDependencies = require('parcel-bundler/src/visitors/dependencies')

const ensureArray = (obj) => (Array.isArray(obj) ? obj : obj != null ? [obj] : [])

class FableAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options)
    this.type = 'js'
    this.outputCode = null
  }

  process() {
    // We don't want to process this asset if the worker is in a warm up phase
    // since the asset will also be processed by the main process, which
    // may cause errors since rust writes to the filesystem.
    if (this.options.isWarmUp) {
      return
    }

    return super.process()
  }

  async parse(code) {
    const babel = await this.requireDependencies()
    const isProduction = false // process.env.NODE_ENV === 'production'
    const port =
      process.env.FABLE_SERVER_PORT != null ? parseInt(process.env.FABLE_SERVER_PORT, 10) : 61225

    let msg = {
      path: this.name,
      define: isProduction ? [] : ['DEBUG'],
    }

    const response = await fableUtils.client.send(port, JSON.stringify(msg))
    const data = JSON.parse(response)

    // ERROR MANAGEMENT
    const { logs = {} } = data
    if (ensureArray(logs.error).length > 0 || ensureArray(logs.warning).length > 0) {
      console.log('DATA' + JSON.stringify(logs))
    }

    const babelOpts = fableUtils.resolveBabelOptions({
      // TODO: Does Parcel require commonjs modules?
      plugins: ['babel-plugin-transform-es2015-modules-commonjs'],
      sourceMaps: false,
      sourceFileName: path.relative(process.cwd(), data.fileName.replace(/\\/g, '/')),
    })
    babelOpts.plugins = babelOpts.plugins.concat([
      fableUtils.babelPlugins.getRemoveUnneededNulls(),
      fableUtils.babelPlugins.getTransformMacroExpressions(babel.template),
    ])

    const transformed = babel.transformFromAst(data, code, babelOpts)
    this.contents = transformed.code
    return data
  }

  traverseFast(visitor) {
    return walk.simple(this.ast, visitor, this)
  }

  collectDependencies() {
    this.traverseFast(collectDependencies)
  }

  async generate() {
    return {
      [this.type]: this.outputCode || this.contents,
    }
  }

  generateErrorMessage(error) {
    return this.projectRelativeName() + ': ' + error.message
  }

  // helpers

  formatFableMessage(x) {
    return x.replace(this.name, this.projectRelativeName())
  }

  projectRelativeName() {
    return path.relative(process.cwd(), this.options.rootDir) + path.sep + this.relativeName
  }

  async requireDependencies() {
    return await localRequire('babel-core', this.options.rootDir)
  }
}

module.exports = FableAsset
