'use strict';

var entryFactory = require('../../../../factory/EntryFactory'),
    is = require('bpmn-js/lib/util/ModelUtil').is,
    getBusinessObject = require('bpmn-js/lib/util/ModelUtil').getBusinessObject,
    getTemplate = require('../Helper').getTemplate,
    findExtension = require('../Helper').findExtension,
    cmdHelper = require('../../../../helper/CmdHelper');

var find = require('lodash/collection/find');

var BASIC_MODDLE_TYPES = [
  'Boolean',
  'Integer',
  'Real',
  'String'
];

var EXTENSION_BINDING_TYPES = [
  'camunda:property',
  'camunda:inputParameter',
  'camunda:outputParameter'
];

var IO_BINDING_TYPES = [
  'camunda:inputParameter',
  'camunda:outputParameter'
];

/**
 * Injects custom properties into the given group.
 *
 * @param {GroupDescriptor} group
 * @param {djs.model.Base} element
 * @param {ElementTemplates} elementTemplates
 * @param {BpmnFactory} bpmnFactory
 */
module.exports = function(group, element, elementTemplates, bpmnFactory) {

  var template = getTemplate(element, elementTemplates);

  if (!template) {
    return;
  }

  if (false) {
    console.log(template, entryFactory, is, getBusinessObject, cmdHelper);
  }

  template.properties.forEach(function(p, idx) {

    var id = 'custom-' + template.id + '-' + idx;

    var entryOptions = {
      id: id,
      description: p.description,
      label: p.label,
      modelProperty: id,
      get: propertyGetter(id, p),
      set: propertySetter(id, p, bpmnFactory),
      validate: propertyValidator(id, p)
    };

    var entry;

    if (p.type === 'Boolean') {
      entry = entryFactory.checkbox(entryOptions);
    }

    if (p.type === 'String') {
      entry = entryFactory.textField(entryOptions);
    }

    if (p.type === 'Text') {
      entry = entryFactory.textArea(entryOptions);
    }

    if (entry) {
      group.entries.push(entry);
    }
  });

};


/////// helpers ////////////////////////


/**
 * Return a getter that retrieves the given property.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 *
 * @return {Function}
 */
function propertyGetter(name, property) {

  /* getter */
  return function(element) {
    var value = getPropertyValue(element, property);

    return objectWithKey(name, value);
  };
}

/**
 * Return a setter that updates the given property.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 * @param {BpmnFactory} bpmnFactory
 *
 * @return {Function}
 */
function propertySetter(name, property, bpmnFactory) {

  /* setter */
  return function(element, values) {

    var value = values[name];

    return setPropertyValue(element, property, value, bpmnFactory);
  };
}

/**
 * Return a validator that ensures the property is ok.
 *
 * @param {String} name
 * @param {PropertyDescriptor} property
 *
 * @return {Function}
 */
function propertyValidator(name, property) {

  /* validator */
  return function(element, values) {
    var value = values[name];

    var error = validateValue(value, property);

    if (error) {
      return objectWithKey(name, error);
    }
  };
}


/**
 * Return the value of the specified property descriptor,
 * on the passed diagram element.
 *
 * @param {djs.model.Base} element
 * @param {PropertyDescriptor} property
 *
 * @return {Any}
 */
function getPropertyValue(element, property) {

  var bo = getBusinessObject(element);

  var binding = property.binding;

  // property
  if (binding.type === 'property') {

    var value = bo.get(binding.target);

    if (binding.target === 'conditionExpression') {
      if (value) {
        return value.body;
      } else {
        // return defined default
        return property.value;
      }
    } else {
      // return value; default to defined default
      return typeof value !== 'undefined' ? value : property.value;
    }
  }

  var camundaProperties,
      camundaProperty;

  if (binding.type === 'camunda:property') {
    camundaProperties = findExtension(bo, 'camunda:Properties');

    if (camundaProperties) {
      camundaProperty = find(camundaProperties.values, function(p) {
        return p.name === binding.name;
      });

      if (camundaProperty) {
        return camundaProperty.value;
      }
    }

    return property.value || '';
  }

  var inputOutput,
      parameter;

  // camunda input parameter
  if (binding.type === 'camunda:inputParameter') {
    inputOutput = findExtension(bo, 'camunda:InputOutput');

    if (inputOutput) {

      parameter = find(inputOutput.inputParameters, function(p) {
        return p.name === binding.target;
      });

      if (parameter) {
        if (binding.scriptFormat) {
          if (parameter.definition) {
            return parameter.definition.value;
          }
        } else {
          return parameter.value;
        }
      }
    }

    // default to property value
    return property.value;
  }

  // camunda output parameter
  if (binding.type === 'camunda:outputParameter') {
    inputOutput = findExtension(bo, 'camunda:InputOutput');

    if (inputOutput) {

      parameter = find(inputOutput.outputParameters, function(p) {
        var script;

        if (binding.scriptFormat) {
          script = p.definition;

          return (
            script.scriptFormat === binding.scriptFormat &&
            // scriptValue ?
            script.value === binding.source
          );
        } else {
          return p.value === binding.source;
        }
      });

      if (parameter) {
        return parameter.name;
      }
    }

    return property.value;
  }

  throw unknownPropertyBinding(property);
}

/**
 * Return an update operation that changes the
 * diagram elements custom property property to the
 * given value.
 *
 * The response of this method will be processed via
 * {@link PropertiesPanel#applyChanges}.
 *
 * @param {djs.model.Base} element
 * @param {PropertyDescriptor} property
 * @param {String} value
 * @param {BpmnFactory} bpmnFactory
 *
 * @return {Object|Array<Object>} results to be processed
 */
function setPropertyValue(element, property, value, bpmnFactory) {
  var bo = getBusinessObject(element);

  var binding = property.binding;

  var bindingType = binding.type;

  var propertyValue;

  var updates = [];


  // property
  if (bindingType === 'property') {

    if (binding.target === 'conditionExpression') {

      propertyValue = bpmnFactory.create('bpmn:FormalExpression', {
        body: value,
        language: binding.scriptFormat
      });
    } else {

      var moddlePropertyDescriptor = bo.$descriptor.propertiesByName[binding.target];

      var moddleType = moddlePropertyDescriptor.type;

      // make sure we only update String, Integer, Real and
      // Boolean properties (do not accidently override complex objects...)
      if (BASIC_MODDLE_TYPES.indexOf(moddleType) === -1) {
        throw new Error('cannot set moddle type <' + moddleType + '>');
      }

      if (moddleType === 'Boolean') {
        propertyValue = !!value;
      } else {
        // TODO(nikku): coerce Integer and Real
        propertyValue = value;
      }
    }

    if (propertyValue !== undefined) {
      updates.push(cmdHelper.updateBusinessObject(
        element, bo, objectWithKey(binding.target, propertyValue)
      ));
    }
  }

  var extensionElements;

  if (EXTENSION_BINDING_TYPES.indexOf(bindingType) !== -1) {
    extensionElements = bo.get('extensionElements');

    // create extension elements, if they do not exist (yet)
    if (!extensionElements) {
      extensionElements = bpmnFactory.create('bpmn:ExtensionElements');

      updates.push(cmdHelper.updateBusinessObject(
        element, bo, objectWithKey('extensionElements', extensionElements)
      ));
    }
  }

  var camundaProperties,
      camundaProperty;

  if (bindingType === 'camunda:property') {

    camundaProperties = find(extensionElements.get('values'), function(v) {
      return is(v, 'camunda:Properties');
    });

    if (!camundaProperties) {
      camundaProperties = bpmnFactory.create('camunda:Properties');

      updates.push(cmdHelper.addElementsTolist(
        element, extensionElements, 'values', [ camundaProperties ]
      ));
    }

    camundaProperty = find(camundaProperties.get('values'), function(p) {
      return p.name === binding.name;
    });

    if (!camundaProperty) {
      camundaProperty = bpmnFactory.create('camunda:Property', {
        name: binding.name,
        value: value
      });

      updates.push(cmdHelper.addElementsTolist(
        element, camundaProperties, 'values', [ camundaProperty ]
      ));
    } else {
      updates.push(cmdHelper.updateBusinessObject(
        element, camundaProperty, objectWithKey('value', value)
      ));
    }
  }


  if (IO_BINDING_TYPES.indexOf(bindingType) !== -1) {
    // TODO(nikku): create camunda:InputOutput
  }

  if (bindingType === 'camunda:inputParameter') {
    // TODO(nikku): create or update camunda:InputParameter
  }

  if (bindingType === 'camunda:outputParameter') {
    // TODO(nikku): create or update camunda:OutputParameter
  }

  if (updates.length) {
    return updates;
  }

  // quick warning for better debugging
  console.warn('no update', element, property, value);
}

function validateValue(value, property) {

  var constraints = property.constraints || {};

  if (constraints.notEmpty && isEmpty(value)) {
    return 'Must not be empty';
  }

  if (constraints.maxLength && value.length > constraints.maxLength) {
    return 'Must have max length ' + constraints.maxLength;
  }

  if (constraints.minLength && value.length > constraints.minLength) {
    return 'Must have min length ' + constraints.minLength;
  }

  var pattern = constraints.pattern,
      message;

  if (pattern) {

    if (typeof pattern !== 'string') {
      message = pattern.message;
      pattern = pattern.value;
    }

    if (!matchesPattern(value, pattern)) {
      return message || 'Must match pattern ' + pattern;
    }
  }
}


/**
 * Return an object with a single key -> value association.
 *
 * @param {String} key
 * @param {Any} value
 *
 * @return {Object}
 */
function objectWithKey(key, value) {
  var obj = {};

  obj[key] = value;

  return obj;
}

/**
 * Does the given string match the specified pattern?
 *
 * @param {String} str
 * @param {String} pattern
 *
 * @return {Boolean}
 */
function matchesPattern(str, pattern) {
  var regexp = new RegExp(pattern);

  return regexp.test(str);
}

function isEmpty(str) {
  return !str || /^\s*$/.test(str);
}

/**
 * Create a new {@link Error} indicating an unknown
 * property binding.
 *
 * @param {PropertyDescriptor} property
 *
 * @return {Error}
 */
function unknownPropertyBinding(property) {
  var binding = property.binding;

  return new Error('unknown binding: <' + binding.type + '>');
}