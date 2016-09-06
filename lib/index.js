yaml = require('js-yaml');
fs   = require('fs');
_ = require('lodash');
preprocessor = require('jolo-preprocessor')




var handlebars = {
  DEFAULT_FUNCTIONS: ['arguments'],
  HANDLEBARS_REGEX: /{{([^*][^}}]*)}}/g,
  HANDLEBARS_ESCAPE:/{{[*]([^}}]*)}}/g,
  FUNCTION_REGEX: /{%([^*][^%}]*)%}/g,
  FUNCTION_ESCAPE: /{%[*]([^%}]*)%}/g,
};

handlebars.getSubObject = function(o, path, depth) {
  depth = depth || 0;
  var key = path[depth];
  return path.length !== ++depth ? this.getSubObject(o[key], path, depth) : o[key];
};



handlebars.getMatches = function(string, regex, index) {
  index || (index = 1); // default to the first capturing group
  var matches = [];
  var match;
  while (match = regex.exec(string)) {
    matches.push(match[index]);
  }
  return matches;
};

//called with every property and it's value
handlebars.processAndFindFieldsWithHandlebars = function(key, object, path, result) {
  var value = object[key];
  if (typeof value === 'string') {
    if(value.match(handlebars.HANDLEBARS_REGEX)) {
      result.fieldsWithHandleBars.push({
        object: object,
        value: value,
        key: key,
        path: path.concat([key]),
      });
    } else if (value.match(handlebars.HANDLEBARS_ESCAPE)){
      value = value.replace(handlebars.HANDLEBARS_ESCAPE, "{{$1}}")
      object[key] = value;
    }

    result.fieldsWithFunctions.push({
      object: object,
      value: value,
      key: key,
      path: path.concat([key])
    });
  }
};

//called with every property and it's value
handlebars.unescapeRemainingFields = function(key, object, path, result) {
  var value = object[key];
  if (typeof value === 'string') {
    if (value.match(handlebars.HANDLEBARS_ESCAPE)){
      value = value.replace(handlebars.HANDLEBARS_ESCAPE, "{{$1}}")
      object[key] = value;
    }
    if (value.match(handlebars.FUNCTION_ESCAPE)){
      value = value.replace(handlebars.FUNCTION_ESCAPE, "{%$1%}")
      object[key] = value;
    }
  }
};

//called with every property and it's value
handlebars.applyFunctions = function(fields, options, raw){
  for(var i in fields){
    var field = fields[i];
    var matches = field.value.match(handlebars.FUNCTION_REGEX);
    var result = [];
    for(var j in matches) {
      var match = matches[j];
      var original = match;
      var clean = handlebars.getMatches(match, handlebars.FUNCTION_REGEX, 1)[0].trim();


      var func = options && options.functions && options.functions[clean];


      if(!func) {
        var stringBuilder = [
          "You have used the function  " + original + " in your spec, but ",
          "did not include a " + clean + " function in the options.functions ",
          "for converting your spec."
        ];
        throw stringBuilder.join('');
      } else {
        var value = func(clean);
        if(typeof value !== 'string'){
          var stringBuilder = [
            "The function " + clean + " that you provided in the ",
            "options.functions object did not return a ",
            "a string. Instead the function returned: " + value + " of type ",
            typeof value + ""
          ];
          throw stringBuilder.join('');
        } else {
          var r = new RegExp(original, 'g');
          field.object[field.key] = field.object[field.key].replace(r, value);

        }

      }
    }
  }
};

handlebars.treeTraverser = function(raw, process, result){

  var traverse = function(o, func, result, path) {
    var p = path || [];
    for (var i in o) {
      func.apply(this, [i, o, p, result]);
      if (o[i] !== null && typeof(o[i]) == "object") {
        //going on step down in the object tree!!
        var newPath = p.concat([i]);
        traverse(o[i], func, result, newPath);
      }
    }
  };
  traverse(raw, process, result);
  return result;
};


handlebars.getHandlebarsInField = function(value){

  var matches = value.match(handlebars.HANDLEBARS_REGEX);
  var result = [];
  for(var j in matches) {
    var match = matches[j];
    var original = match;
    var clean = handlebars.getMatches(match, handlebars.HANDLEBARS_REGEX, 1)[0].trim();
    //var pathToValue = object.split('.');
    result.push({clean: clean, original: original});
  }
  return result;
};


handlebars.organizeByKey = function(fieldsWithHandleBars){
  var byKey = {};
   for(var i in fieldsWithHandleBars){

     var f = fieldsWithHandleBars[i];
     var k = f.path.join('.');

     byKey[k] = {};
     byKey[k]['object'] = f['object'];
     byKey[k]['fieldName'] = f['key'];
     byKey[k]['handlebars'] = [];
     var fs = handlebars.getHandlebarsInField(f.value);
     for(var j in fs){
       byKey[k]['handlebars'].push({
         path: fs[j].clean,
         original: fs[j].original,
         link: undefined,
         value: null
       });
     }

   }
   return byKey;
};


handlebars.makeReferences = function(byKey){

  for (var key in byKey){
    var allFields = byKey[key];
    for(var i in allFields.handlebars){
      var handlebar = allFields.handlebars[i];
      for (var key2 in byKey){
        if(key2.indexOf(handlebar.path) == 0 && (key2 == handlebar.path || key2.indexOf(handlebar.path) + '.')){
          handlebar.link = byKey[key2];
        }
      }
    }

  }
};

handlebars.isCyclic = function(obj, originalCopy) {
  var keys = [];
  var stack = [];
  var stackSet = new Set();
  var detected = false;
  var result = [];

  function detect(obj, key) {
    if (typeof obj != 'object') { return; }

    if (stackSet.has(obj)) { // it's cyclic! Print the object and its locations.
      var oldindex = stack.indexOf(obj);

      var objKey = keys[1];
      var originalObj = originalCopy[objKey];
      var originalField = originalObj.object[originalObj.fieldName];

      result.push(keys[1] + " -> " + originalField);

      var l1 = keys.join('.') + '.' + key;
      var l2 = keys.slice(0, oldindex + 1).join('.');
      detected = true;
      return;
    }

    keys.push(key);
    stack.push(obj);
    stackSet.add(obj);
    for (var k in obj) { //dive on the object's children
      if (obj.hasOwnProperty(k)) { detect(obj[k], k); }
    }

    keys.pop();
    stack.pop();
    stackSet.delete(obj);
    return;
  }

  detect(obj, 'obj');
  return result;
};

handlebars.getValuesAndWrite = function(obj, raw){

  for (var i in obj.handlebars){
    var handlebar = obj.handlebars[i];
    var value = undefined;
    if(handlebar.link){
      value = handlebars.getValuesAndWrite(handlebar.link, raw);
    } else {
      value = handlebars.getSubObject(raw, handlebar.path.split('.'))
    }

    if(value === undefined) {
      var stringBuilder = [
        "Can't find field " + handlebar.original,
        " which you are referencing in the " + obj.fieldName + " field"
      ];

      throw  stringBuilder.join();
    }

    handlebar.value = value;

    var r = new RegExp(handlebar.original, 'g');

    obj.isDone = true;

    if(obj.object[obj.fieldName].trim() === handlebar.original.trim()){
      obj.object[obj.fieldName] = value;
    } else {
      obj.object[obj.fieldName] = obj.object[obj.fieldName].replace(r, value);
    }
  }



  return obj.object[obj.fieldName];
};


// TODO known problem: fieldnames with a dot
handlebars.replaceHandlebars = function(raw, result){
  var byKey = handlebars.organizeByKey(result.fieldsWithHandleBars);
  var originalCopy = JSON.parse(JSON.stringify(byKey));
  handlebars.makeReferences(byKey);
  var cyclic = handlebars.isCyclic(byKey, originalCopy);
  if(cyclic.length > 0){
    var error = ['There is a cyclic reference in your spec: '];
    error = error.concat(cyclic);
    throw error.join('\n');
  }
  for(var key in byKey){
    var obj = byKey[key];
    if(!obj.isDone){
      handlebars.getValuesAndWrite(obj, raw);
    }

  }

};


handlebars.checkFunctions = function(functions, result){
  for(var i in result.fieldsWithFunctions){
    var field = result.fieldsWithFunctions[i];
    var matches = field.value.match(handlebars.FUNCTION_REGEX);
    for(var j in matches) {
      var match = matches[j];
      try{
        var func = handlebars.getMatches(match, handlebars.FUNCTION_REGEX, 1)[0].trim();

        if(functions.indexOf(func) === -1) {
          throw "error";
        }
      } catch (ex) {
        var stringBuilder = [
          "Function " + match + " in field \"" + field.value,
          " could not be found.\n",
          "Path: " + field.path.join('.')
        ]
        throw  stringBuilder.join('');
      }
    }
  }
};

handlebars.transform = function(raw, options){
  var customFunctions = (options && options.functions) || {};

  var validFunctions = handlebars.DEFAULT_FUNCTIONS.concat(Object.keys(customFunctions));


  var data = {}
  data.fieldsWithHandleBars = [];
  data.fieldsWithFunctions = [];

  //called with every property and it's value


  var result = handlebars.treeTraverser(raw, handlebars.processAndFindFieldsWithHandlebars, data);

  handlebars.checkFunctions(validFunctions, result);
  handlebars.replaceHandlebars(raw, result);

  //handlebars.applyFunctions(result.fieldsWithFunctions, options);

  var result = handlebars.treeTraverser(raw, handlebars.unescapeRemainingFields, {});

  return raw;
};


var external = {
  convert : function(filePaths, options, callback){

    try {
      var raw = {};
      for(var i in filePaths){
        _.assignIn(raw, yaml.load(fs.readFileSync(filePaths, 'utf8'), function(err, res){
          throw err;
        }));
      }
      preprocessor.preprocess(raw, options, function(res, err){
        if(err){
          throw err;
        }
      });
      var transformed = handlebars.transform(raw, options);
      callback(null, transformed);
      return transformed;


    } catch (ex) {
      callback(ex);
    }
  }
};

module.exports = external;
