// Copyright IBM Corp. 2015,2016. All Rights Reserved.
// Node module: loopback-sdk-ios-codegen
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

var fs = require('fs');
var ejs = require('ejs');
var pascalCase = require('pascal-case');

/**
 * Generate iOS Client-side Objective-C representation of the models.
 *
 * @param {Object} app The loopback application created via `app = loopback()`.
 * @returns {Object} A hash map indexed by file names with file contents as the value.
 */
exports.objcModels = function generateServices(app, modelPrefix, verbose) {

  var models = describeModels(app);

  addObjCNames(models, modelPrefix, verbose);

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
    var modelDefinition = app.models[name].definition;

    if (!c.ctor) {
      // Skip classes that don't have a shared ctor
      // as they are not LoopBack models
      console.error('Skipping %j as it is not a LoopBack model', name);
      return;
    }

    // Skip the User class as its Obj-C implementation is provided as a part of the SDK framework.
    var isUser = c.sharedClass.ctor.prototype instanceof app.loopback.User ||
      c.sharedClass.ctor.prototype === app.loopback.User.prototype;
    if (isUser) {
      return;
    }

    c.pluralName = c.sharedClass.ctor.pluralModelName;
    c.props = modelDefinition.properties;
    c.baseModel = modelDefinition.settings.base;
    if (c.baseModel != null && typeof(c.baseModel) === 'function') {
      c.baseModel = '';
    }
    if (modelDefinition._ids != null) {
      c.isGenerated = modelDefinition._ids[0].property.generated;
    } else {
      c.isGenerated = false;
    }
    c.relations = modelDefinition.settings.relations;
    c.acls = modelDefinition.settings.acls;
    c.validations = modelDefinition.settings.validations;

    c.methods.forEach(function fixArgsOfPrototypeMethods(method) {
      var ctor = method.restClass.ctor;
      if (!ctor || method.sharedMethod.isStatic) return;
      method.accepts = ctor.accepts.concat(method.accepts);
    });

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

var methodNamesToSkip = [
  // The followings are pre-implemented in LBPersistedModel.
  'create',
  'upsert',
  'deleteById',
  // The followings are to be supported.
  'createChangeStream',
  'prototype.updateAttributes'
];

var objcMethodNamesToSkip = [
  // The following is skipped since `updateAll` invocation fails with an empty `where` argument
  // and there is no way to provide a working implementation for it.
  'updateAllWithData'
];

// Amend auto-generated method names which don't sound right.
var methodNameReplacementTable = {
  'findByIdWithId':     'findById',
  'findWithSuccess':    'allWithSuccess',
  'updateAllWithWhere': 'updateAllWithWhereFilter',
  'countWithWhere':     'countWithWhereFilter'
};

// Type declaration conversion table for properties.
// To list all the conversion rules in a uniform manner, `<...>` notation is introduced.
var propTypeConversionTable = {
  'String':  '(nonatomic, copy) NSString *',
  'Number':  'NSNumber *',
  'Boolean': 'BOOL ',
  '<array>': '(nonatomic) NSArray *'
};

// Type conversion table for arguments.
// To list all the conversion rules in a uniform manner, `<...>` notation is introduced.
var argTypeConversionTable = {
  'object data': '<objcModelType>', // Special case: the argument whose type is `object` and name is `data`.
  'object':      'NSDictionary *',
  'any':         'id'
}

// Return type to Obj-C return type conversion table.
var returnTypeConversionTable = {
  'object':   'NSDictionary',
  'number':   'NSNumber',
  'boolean':  'BOOL',
  '<array>':  'NSArray',
  '<void>':   'void'
};

function addObjCNames(models, modelPrefix, verbose) {
  for (var modelName in models) {
    if (verbose) {
      console.error('\nProcessing model: "' + modelName + '"...');
    }
    var meta = models[modelName];
    meta.objcModelName = modelPrefix + pascalCase(modelName);
    meta.objcRepoName = meta.objcModelName + 'Repository';
    if (meta.baseModel === 'Model' || meta.baseModel === 'PersistedModel') {
      meta.objcBaseModel = 'LB' + meta.baseModel;
    } else {
      throw new Error('Unknown base model: "' + meta.baseModel + '" for model: "' + modelName + '"');
    }
    meta.objcProps = [];
    for (var propName in meta.props) {
      if (propName === 'id') {
        // `_id` is already defined in LBPersistedModel
        continue;
      }
      var prop = meta.props[propName];
      if (verbose) {
        console.error(' Property: "' + propName + '"', prop);
      }
      var objcProp = convertToObjCPropType(prop.type);
      if (typeof objcProp === 'undefined') {
        throw new Error(
          'Unsupported property type: "' + prop.type.name + '" in model: "' + modelName + '"');
      }
      meta.objcProps.push({name: propName, type: objcProp})
    }

    meta.objcMethods = [];
    meta.methods.forEach(function(method) {
      if (verbose) {
        console.error(' Method: "' + method.name + '"', method);
      }
      addObjCMethodInfo(meta, method, modelName, true);
      if (hasOptionalArguments(method)) {
        addObjCMethodInfo(meta, method, modelName, false);
      }
    });
  }
}

function addObjCMethodInfo(meta, method, modelName, skipOptionalArguments) {
  if (methodNamesToSkip.indexOf(method.name) >= 0) {
    return;
  }
  var methodPrototype = '';
  var methodName = method.name;
  var paramAssignments;
  var bodyParamAssignments;
  method.accepts.forEach(function (param) {
    var paramRequired = param.required || (param.http && param.http.source === 'body');
    if (!paramRequired && skipOptionalArguments) {
      return;
    }
    var objcModelType = meta.objcModelName + ' *';
    var argType = convertToObjCArgType(param.type, param.arg, objcModelType);
    if (typeof argType === 'undefined') {
      throw new Error(
        'Unsupported argument type: "' + param.type + '" in model: "' + modelName + '"');
    }
    var argName = (param.arg === 'id') ? 'id_' : param.arg;
    var argRightValue = argName;
    if (argType === objcModelType) {
      argRightValue = '[' + param.arg + ' toDictionary]';
    } else if (argType === 'NSDictionary *') {
      argRightValue = '(' + param.arg + ' ? ' + param.arg + ' : @{})';
    }
    if (methodName === method.name) {
      methodName += 'With' + param.arg[0].toUpperCase() + param.arg.slice(1);
    } else {
      methodPrototype += ' ' + param.arg;
    }
    if (param.http && param.http.source === 'body') {
      if (bodyParamAssignments) {
        throw new Error(
          'Multiple body arguments specified in method: "' + method.name +
          '" of model: "' + modelName + '"');
      }
      bodyParamAssignments = argRightValue;
    } else {
      if (!paramAssignments) {
        paramAssignments = '@"' + param.arg + '": ' + argRightValue;
      } else {
        paramAssignments += ', @"' + param.arg + '": ' + argRightValue;
      }
    }

    methodPrototype += ':(' + argType + ')' + argName;
  });

  var returnArg = method.returns[0] && method.returns[0].arg;
  var returnType = method.returns[0] && method.returns[0].type;
  var objcReturnType = convertToObjCReturnType(returnType, modelName, meta.objcModelName);
  if (typeof objcReturnType === 'undefined') {
    throw new Error(
      'Unsupported return type: "' + returnType + '" in method: "' + method.name +
      '" of model: "' + modelName + '"');
  }
  var successBlockType = convertToObjCSuccessBlockType(objcReturnType);

  if (methodName === method.name) {
    methodName += 'WithSuccess';
    methodPrototype += ':(' + successBlockType + ')success ';
  } else {
    methodPrototype += '\n        success:(' + successBlockType + ')success';
  }
  methodPrototype   += '\n        failure:(SLFailureBlock)failure';

  if (objcMethodNamesToSkip.indexOf(methodName) >= 0) {
    return;
  }
  if (methodNameReplacementTable[methodName]) {
    methodName = methodNameReplacementTable[methodName];
  }
  methodPrototype = '(void)' + methodName + methodPrototype;

  meta.objcMethods.push({
    rawName: method.name,
    prototype: methodPrototype,
    returnArg: returnArg,
    objcReturnType: objcReturnType,
    paramAssignments: paramAssignments,
    bodyParamAssignments: bodyParamAssignments
  });
  method.objcGenerated = true;
}

function hasOptionalArguments(method) {
  for (var idx in method.accepts) {
    var param = method.accepts[idx];
    var paramRequired = param.required || (param.http && param.http.source === 'body');
    if (!paramRequired) {
      return true;
    }
  }
  return false;
}

function convertToObjCPropType(type) {
  if (Array.isArray(type)) {
    return propTypeConversionTable['<array>'];
  }
  return propTypeConversionTable[type.name];
}

function convertToObjCArgType(type, name, objcModelType) {
  var objcType = argTypeConversionTable[type + ' ' + name];
  objcType = objcType || argTypeConversionTable[type];
  if (objcType) {
    objcType = objcType.replace('<objcModelType>', objcModelType);
  }
  return objcType;
}

function convertToObjCReturnType(type, modelName, objcModelName) {
  if (type === modelName) {
    return objcModelName;
  }
  if (typeof type === 'undefined') {
    type = '<void>';
  }
  if (Array.isArray(type)) {
    type = '<array>';
  }
  return returnTypeConversionTable[type];
}

function convertToObjCSuccessBlockType(objcType) {
  var returnArgType;
  if (objcType === 'void') {
    returnArgType = '';
  } else if (objcType === 'BOOL') { // primitive type
    returnArgType = objcType;
  } else {
    returnArgType = objcType + ' *';
  }
  return 'void (^)(' + returnArgType + ')';
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

