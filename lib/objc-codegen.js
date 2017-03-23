// Copyright IBM Corp. 2015,2016. All Rights Reserved.
// Node module: loopback-sdk-ios-codegen
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

let fs = require('fs');
let ejs = require('ejs');
let pascalCase = require('pascal-case');
let modelsName = Array();

/**
 * Generate iOS Client-side Objective-C representation of the models.
 *
 * @param {Object} app The loopback application created via `app = loopback()`.
 * @returns {Object} A hash map indexed by file names with file contents as the value.
 */
exports.objcModels = function generateServices(app, modelPrefix, verbose) {

  let models = describeModels(app);

  /* Store list models name */
  for (let modelName in models) {

    if (models.hasOwnProperty(modelName)) {
      modelsName[modelsName.length] = models[modelName].name;

      /* Update list include data from other model */
      models[modelName].moreInclude = [];
      models[modelName].moreRepo = [];

      for (let relation in models[modelName].relations) {

        if (models[modelName].relations.hasOwnProperty(relation)) {
          let relationModel = models[modelName].relations[relation].model;

          if(!((typeof relationModel) === 'undefined')) {
            if (relationModel != models[modelName].name && models[modelName].moreInclude.indexOf(relationModel) == -1) {
              models[modelName].moreInclude[models[modelName].moreInclude.length] = modelPrefix + pascalCase(relationModel);
            }
          }

          relationModel = models[modelName].relations[relation].through;

          if(!((typeof relationModel) === 'undefined')) {
            if (relationModel != models[modelName].name && models[modelName].moreInclude.indexOf(relationModel) == -1) {
              models[modelName].moreInclude[models[modelName].moreInclude.length] = modelPrefix + pascalCase(relationModel);
            }
          }

        }
      }
    }

  }

  addObjCNames(models, modelPrefix, verbose);

  let objcModelHTemplate = readTemplate('./objc-model-h.ejs');
  let objcModelMTemplate = readTemplate('./objc-model-m.ejs');
  let objcRepoHTemplate  = readTemplate('./objc-repo-h.ejs');
  let objcRepoMTemplate  = readTemplate('./objc-repo-m.ejs');
  let objcAllMTemplate   = readTemplate('./objc-all-h.ejs');

  let ret = {};

  for (let modelName in models) {
    let modelDesc = models[modelName];
    let objcModelName = models[modelName].objcModelName;

    let script = renderContent(objcModelHTemplate, modelDesc);
    ret[objcModelName + '.h'] = script;

    script = renderContent(objcModelMTemplate, modelDesc);
    ret[objcModelName + '.m'] = script;

    script = renderContent(objcRepoHTemplate, modelDesc);
    ret[objcModelName + 'Repository.h'] = script;

    script = renderContent(objcRepoMTemplate, modelDesc);
    ret[objcModelName + 'Repository.m'] = script;
  }

  /* Create include all for easy use */
  let allScript = renderContent(objcAllMTemplate, models);
  ret["LoopbackModelImport.h"] = allScript;

  return ret;
};

function describeModels(app) {
  let result = {};
  for(let model in app.models) {
    model.get;
  }
  app.handler('rest').adapter.getClasses().forEach(function(c) {
    let name = c.name;
    let modelDefinition = app.models[name].definition;

    if (!c.ctor) {
      // Skip classes that don't have a shared ctor
      // as they are not LoopBack models
      console.error('Skipping %j as it is not a LoopBack model', name);
      return;
    }

    // Skip the User class as its Obj-C implementation is provided as a part of the SDK framework.
    let isUser = c.sharedClass.ctor.prototype instanceof app.loopback.User ||
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
      let ctor = method.restClass.ctor;
      if (!ctor || method.sharedMethod.isStatic) return;
      method.accepts = ctor.accepts.concat(method.accepts);
    });

    result[name] = c;
  });

  buildScopes(result);

  return result;
}

let SCOPE_METHOD_REGEX = /^prototype.__([^_]+)__(.+)$/;

function buildScopes(models) {
  for (let modelName in models) {
    buildScopesOfModel(models, modelName);
  }
}

function buildScopesOfModel(models, modelName) {
  let modelClass = models[modelName];

  modelClass.scopes = {};
  modelClass.methods.forEach(function(method) {
    buildScopeMethod(models, modelName, method);
  });

  return modelClass;
}

// reverse-engineer scope method
// defined by loopback-datasource-juggler/utility/scope.js
function buildScopeMethod(models, modelName, method) {
  let modelClass = models[modelName];
  let match = method.name.match(SCOPE_METHOD_REGEX);
  if (!match) return;

  let op = match[1];
  let scopeName = match[2];
  let modelPrototype = modelClass.sharedClass.ctor.prototype;
  let targetClass = modelPrototype[scopeName]._targetClass;

  // Check rename method in special case
  if (match[0].indexOf("prototype.") != -1) {
    method.name = op + "__" + scopeName
  }

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

  let apiName = scopeName;
  if (op == 'get') {
    // no-op, create the scope accessor
  } else if (op == 'delete') {
    apiName += '.destroyAll';
  } else {
    apiName += '.' + op;
  }

  let scopeMethod = Object.create(method);
  /* Remove reverseName, it's always undefined and somethings error */
  scopeMethod.name = scopeName;
  //scopeMethod.name = reverseName;
  // override possibly inherited values
  scopeMethod.deprecated = false;
  scopeMethod.internal = false;
  modelClass.scopes[scopeName].methods[apiName] = scopeMethod;
  if(scopeMethod.name.match(/create/)){
    let scopeCreateMany = Object.create(scopeMethod);
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
  for (let n in models) {
    if (n.toLowerCase() == name.toLowerCase())
      return models[n];
  }
}

let methodNamesToSkip = [
  // The followings are pre-implemented in LBPersistedModel.
  'create',
  'upsert',
  'deleteById',
  // The followings are to be supported.
  'createChangeStream',
  'prototype.updateAttributes',
   'prototype.patchAttributes'
];

let objcMethodNamesToSkip = [
  // The following is skipped since `updateAll` invocation fails with an empty `where` argument
  // and there is no way to provide a working implementation for it.
  'updateAllWithData'
];

// Amend auto-generated method names which don't sound right.
let methodNameReplacementTable = {
  'findByIdWithId':     'findById',
  'findWithSuccess':    'allWithSuccess',
  'updateAllWithWhere': 'updateAllWithWhereFilter',
  'countWithWhere':     'countWithWhereFilter'
};

// Type declaration conversion table for properties.
// To list all the conversion rules in a uniform manner, `<...>` notation is introduced.
let propTypeConversionTable = {
  'String':   '(nonatomic, copy) NSString *',
  'Number':   'NSNumber *',
  'Boolean':  'BOOL ',
  '<array>':  '(nonatomic) NSArray *',
  'ObjectID': '(nonatomic, copy) NSString *',
  'Date':     'NSDate *',
  'object':   'NSDictionary *',
  'Object':   'NSDictionary *'
};

// Swift to list all the conversion rules in a uniform manner, `<...>` notation is introduced.
let swiftPropTypeConversionTable = {
  'String':  '(nonatomic, copy) NSString *',
  'Number':  'NSNumber *',
  'Boolean': 'BOOL ',
  '<array>': '(nonatomic) NSArray *',
  'ObjectID': '(nonatomic, copy) NSString *'
};

// Type conversion table for arguments.
// To list all the conversion rules in a uniform manner, `<...>` notation is introduced.
let argTypeConversionTable = {
  'object data': '<objcModelType>', // Special case: the argument whose type is `object` and name is `data`.
  'object':      'NSDictionary *',
  'any':         'id',
  'boolean':     'NSNumber *',
  'Boolean':     'NSNumber *',
  'string':      'NSString *',
  'String':      'NSString *',
  'number':      'NSNumber *'
};

// Swift To list all the conversion rules in a uniform manner, `<...>` notation is introduced.
let swiftArgTypeConversionTable = {
  'object data': '<objcModelType>', // Special case: the argument whose type is `object` and name is `data`.
  'object':      'NSDictionary?',
  'any':         'id',
  'boolean':     'NSNumber?',
  'Boolean':     'NSNumber?',
  'string':      'NSString?',
  'String':      'NSString?',
  'number':      'NSNumber?'
};


// Return type to Obj-C return type conversion table.
let returnTypeConversionTable = {
  'object':   'NSDictionary',
  'number':   'NSNumber',
  'boolean':  'BOOL',
  '<array>':  'NSArray',
  '<void>':   'void'
};

// Return type to Swift return type conversion table.
let swiftReturnTypeConversionTable = {
  'object':   'NSDictionary',
  'number':   'NSNumber',
  'boolean':  'BOOL',
  '<array>':  'NSArray',
  '<void>':   'void'
};

function addObjCNames(models, modelPrefix, verbose) {
  for (let modelName in models) {
    if (verbose) {
      console.error('\nProcessing model: "' + modelName + '"...');
    }
    let meta = models[modelName];
    meta.objcModelName = modelPrefix + pascalCase(modelName);
    meta.objcRepoName = meta.objcModelName + 'Repository';
    if (meta.baseModel === 'Model' || meta.baseModel === 'PersistedModel') {
      meta.objcBaseModel = 'LB' + meta.baseModel;
    } else {
      throw new Error('Unknown base model: "' + meta.baseModel + '" for model: "' + modelName + '"');
    }
    meta.objcProps = [];
    for (let propName in meta.props) {
      if (propName === 'id') {
        // `_id` is already defined in LBPersistedModel
        continue;
      }
      let prop = meta.props[propName];
      if (verbose) {
        console.error(' Property: "' + propName + '"', prop);
      }
      let objcProp = convertToObjCPropType(prop.type);
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
  let methodPrototype = '';
  let methodName = method.name;
  methodName = methodName.replace("prototype.", "");
  let paramAssignments;
  let bodyParamAssignments;
  method.accepts.forEach(function (param) {
    // Skip arguments derived by a server-side code
    if (isServerComputedArg(param)) {
      return;
    }

    var paramRequired = param.required || (param.http && param.http.source === 'body');
    if (!paramRequired && skipOptionalArguments) {
      return;
    }

    let objcModelType = meta.objcModelName + ' *';
    if(typeof(param.model) == "string") {
     objcModelType = param.model + ' *';
    }

    let argType = convertToObjCArgType(param.type, param.arg, objcModelType);
    if (typeof argType === 'undefined') {
      throw new Error(
        'Unsupported argument type: "' + param.type + '" in model: "' + modelName + '"');
    }
    let argName = (param.arg === 'id') ? 'id_' : param.arg;
    let argRightValue = argName;
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

  let returnArg = method.returns[0] && method.returns[0].arg;
  let returnType = method.returns[0] && method.returns[0].type;
  let objcReturnType = convertToObjCReturnType(returnType, modelName, meta.objcModelName);
  if (typeof objcReturnType === 'undefined') {
    throw new Error(
      'Unsupported return type: "' + returnType + '" in method: "' + method.name +
      '" of model: "' + modelName + '"');
  }
  let successBlockType = convertToObjCSuccessBlockType(objcReturnType);

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
  let newTypeReturn = "";
  if(Array.isArray(returnType)) {
    newTypeReturn = returnType[0];
  }

  meta.objcMethods.push({
    rawName: method.name,
    prototype: methodPrototype,
    returnArg: returnArg,
    objcReturnType: objcReturnType,
    originObjcReturnType: newTypeReturn,
    paramAssignments: paramAssignments,
    bodyParamAssignments: bodyParamAssignments
  });
  method.objcGenerated = true;
}

function hasOptionalArguments(method) {
  for (var idx in method.accepts) {
    var param = method.accepts[idx];
    if (isServerComputedArg(param)) {
      continue;
    }
    var paramRequired = param.required || (param.http && param.http.source === 'body');
    if (!paramRequired) {
      return true;
    }
  }
  return false;
}

function isServerComputedArg(param) {
  if (typeof param.http === 'function') {
    return true;
  }

  var httpSource = param.http && param.http.source;
  return httpSource === 'req' ||
    httpSource === 'res' ||
    httpSource === 'context';
}

function convertToObjCPropType(type) {
  if (Array.isArray(type)) {
    return propTypeConversionTable['<array>'];
  }
  return propTypeConversionTable[type.name];
}

function convertToObjCArgType(type, name, objcModelType) {
  let objcType = argTypeConversionTable[type + ' ' + name];
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

  /* In case not found any type,
   * it maybe is object type from other model, must return type name
   */
  if (modelsName.indexOf(type) != -1) {
    return pascalCase(type);
  }

  if (typeof type === 'undefined') {
    type = '<void>';
  }
  if (Array.isArray(type)) {
    type = '<array>';
  }
  
  if (typeof type === 'object') {
    // anonymous object type, e.g.
    // { arg: 'info', type: { count: 'number' }}
    // TODO(bajtos) convert this to a proper ObjC type
    type = 'object';
  }
  
  return returnTypeConversionTable[type];
}

function convertToObjCSuccessBlockType(objcType) {
  let returnArgType;
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
  let ret = fs.readFileSync(
    require.resolve(filename),
    { encoding: 'utf-8' }
  );
  return ret;
}

function renderContent(template, modelMetaInfo) {
  let script = ejs.render(
    template,
    { meta: modelMetaInfo }
  );
  return script;
}

