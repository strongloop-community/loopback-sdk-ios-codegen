var fs = require('fs');
var ejs = require('ejs');
var pascalCase = require('pascal-case');

/**
 * Generate iOS Client-side Objective-C representation of the models.
 *
 * @param {Object} app The loopback application created via `app = loopback()`.
 * @returns {Object} A hash map indexed by file names with file contents as the value.
 */
exports.objcModels = function generateServices(app, modelPrefix) {

  var models = describeModels(app);

  addObjCNames(models, modelPrefix);

  var objcModelHTemplate = readTemplate('./objc-model-h.ejs');
  var objcModelMTemplate = readTemplate('./objc-model-m.ejs');
  var objcRepoHTemplate  = readTemplate('./objc-repo-h.ejs');
  var objcRepoMTemplate  = readTemplate('./objc-repo-m.ejs');

  var ret = {};

  for (var modelName in models) {
    var modelDesc = models[modelName];
    var objcModelName = models[modelName].objcModelName;

    var script = renderContent(objcModelHTemplate, modelDesc);
    ret[objcModelName + '.h'] = script;

    var script = renderContent(objcModelMTemplate, modelDesc);
    ret[objcModelName + '.m'] = script;

    var script = renderContent(objcRepoHTemplate, modelDesc);
    ret[objcModelName + 'Repository.h'] = script;

    var script = renderContent(objcRepoMTemplate, modelDesc);
    ret[objcModelName + 'Repository.m'] = script;
  }

  return ret;
};

function describeModels(app) {
  var result = {};
  for(var model in app.models) {
    model.get;
  }
  app.handler('rest').adapter.getClasses().forEach(function(c) {
    var name = c.name;

    if (!c.ctor) {
      // Skip classes that don't have a shared ctor
      // as they are not LoopBack models
      console.error('Skipping %j as it is not a LoopBack model', name);
      return;
    }
    c.methods.forEach(function fixArgsOfPrototypeMethods(method) {
      var ctor = method.restClass.ctor;
      if (!ctor || method.sharedMethod.isStatic) return;
      method.accepts = ctor.accepts.concat(method.accepts);
    });

    // Skip the User class as its Obj-C implementation is provided as a part of the SDK framework.
    var isUser = c.sharedClass.ctor.prototype instanceof app.loopback.User ||
      c.sharedClass.ctor.prototype === app.loopback.User.prototype;
    if (isUser) {
      return;
    }

    c.pluralName = c.sharedClass.ctor.pluralModelName;
    c.params =  app.models[c.name].definition.properties;
    c.baseModel = app.models[c.name].definition.settings.base;

    if (c.baseModel != null && typeof(c.baseModel) === 'function') {
      c.baseModel = '';
    }
    if (app.models[c.name].definition._ids != null) {
      c.isGenerated = app.models[c.name].definition._ids[0].property.generated;
    } else {
      c.isGenerated = false;
    }
    c.relations = app.models[c.name].definition.settings.relations;
    c.acls = app.models[c.name].definition.settings.acls;
    c.validations = app.models[c.name].definition.settings.validations;

    result[name] = c;
  });

  buildScopes(result);

  return result;
}

var SCOPE_METHOD_REGEX = /^prototype.__([^_]+)__(.+)$/;

function buildScopes(models) {
  for (var modelName in models) {
    buildScopesOfModel(models, modelName);
  }
}

function buildScopesOfModel(models, modelName) {
  var modelClass = models[modelName];

  modelClass.scopes = {};
  modelClass.methods.forEach(function(method) {
    buildScopeMethod(models, modelName, method);
  });

  return modelClass;
}

// reverse-engineer scope method
// defined by loopback-datasource-juggler/lib/scope.js
function buildScopeMethod(models, modelName, method) {
  var modelClass = models[modelName];
  var match = method.name.match(SCOPE_METHOD_REGEX);
  if (!match) return;

  var op = match[1];
  var scopeName = match[2];
  var modelPrototype = modelClass.sharedClass.ctor.prototype;
  var targetClass = modelPrototype[scopeName]._targetClass;

  if (modelClass.scopes[scopeName] === undefined) {
    if (!targetClass) {
      console.error(
        'Warning: scope %s.%s is missing _targetClass property.' +
        '\nThe iOS code for this scope won\'t be generated.' +
        '\nPlease upgrade to the latest version of' +
        '\nloopback-datasource-juggler to fix the problem.',
        modelName, scopeName);
      modelClass.scopes[scopeName] = null;
      return;
    }

    if (!findModelByName(models, targetClass)) {
      console.error(
        'Warning: scope %s.%s targets class %j, which is not exposed ' +
        '\nvia remoting. The iOS code for this scope won\'t be generated.',
        modelName, scopeName, targetClass);
      modelClass.scopes[scopeName] = null;
      return;
    }

    modelClass.scopes[scopeName] = {
    methods: {},
    targetClass: targetClass
    };
  } else if (modelClass.scopes[scopeName] === null) {
    // Skip the scope, the warning was already reported
    return;
  }

  var apiName = scopeName;
  if (op == 'get') {
    // no-op, create the scope accessor
  } else if (op == 'delete') {
    apiName += '.destroyAll';
  } else {
    apiName += '.' + op;
  }

  var scopeMethod = Object.create(method);
  scopeMethod.name = reverseName;
  // override possibly inherited values
  scopeMethod.deprecated = false;
  scopeMethod.internal = false;
  modelClass.scopes[scopeName].methods[apiName] = scopeMethod;
  if(scopeMethod.name.match(/create/)){
    var scopeCreateMany = Object.create(scopeMethod);
    scopeCreateMany.name = scopeCreateMany.name.replace(
      /create/,
      'createMany'
    );
    scopeCreateMany.isReturningArray = function() { return true; };
    apiName = apiName.replace(/create/, 'createMany');
    modelClass.scopes[scopeName].methods[apiName] = scopeCreateMany;
  }
}

function findModelByName(models, name) {
  for (var n in models) {
    if (n.toLowerCase() == name.toLowerCase())
      return models[n];
  }
}

function addObjCNames(models, modelPrefix) {
  for (var modelName in models) {
    var meta = models[modelName];
    meta.objcModelName = modelPrefix + pascalCase(modelName);
    if (meta.baseModel === 'Model' || meta.baseModel === 'PersistedModel') {
      meta.objcBaseModel = 'LB' + meta.baseModel;
    } else {
      throw new Error('Unknown base model: ' + meta.baseModel + ' for model: ' + modelName);
    }

    meta.objcParams = [];
    for (var param in meta.params) {
      var type = meta.params[param].type;
      var name = type.name;
      if (name === 'String') {
        meta.params[param].type.objcName = '(nonatomic, copy) NSString *';
      } else if (name === 'Number') {
        meta.params[param].type.objcName = 'long ';
      } else if (name === 'Boolean') {
        meta.params[param].type.objcName = 'BOOL ';
      } else if (Array.isArray(type)) {
        meta.params[param].type.objcName = '(nonatomic) NSArray *';
      } else {
        throw new Error('Unsupported parameter type: ' + name + ' in model: ' + modelName);
      }
    }
  }
}

function readTemplate(filename) {
  var ret = fs.readFileSync(
    require.resolve(filename),
    { encoding: 'utf-8' }
  );
  return ret;
}

function renderContent(template, modelMetaInfo) {
  var script = ejs.render(
    template,
    { meta: modelMetaInfo }
  );
  return script;
}

