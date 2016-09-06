import { flatMap, forEach, fromPairs, isEqual, map, partition, uniq, values } from "lodash";

import { parse } from "graphql/language";

export function execute(root, query) {
    const request = requestFromGraphqlAst(parse(query).definitions[0]);
    return root.fetch(request)[0].value;
}

export function many(target, generateContext, join) {
    return new Relationship({
        target,
        generateContext,
        join,
        defaultValue: [],
        processResults: x => x
    });
}

export function single(target, generateContext, join) {
    return new Relationship({
        target,
        generateContext,
        join,
        defaultValue: null,
        processResults: singleValue
    });
}

function singleValue(values) {
    if (values.length === 0) {
        return null;
    } else if (values.length === 1) {
        return values[0];
    } else {
        throw new Error("TODO");
    }
}

// TODO: the order of lodash.values() (and Object.keys()?) is not guaranteed,
// but they need to line up for multi-field joins

class RelationshipResults {
    constructor(options) {
        this._results = options.results;
        this._join = options.join;
        this._defaultValue = options.defaultValue;
        this._processResults = options.processResults;
    }
    
    get(parentJoinValues) {
        // TODO: turn results into a map to avoid n^2 time
        const values = this._results
            .filter(result => isEqual(result.joinValues, parentJoinValues))
            .map(result => result.value);
        return this._processResults(values);
    }
}

class Relationship {
    constructor(options) {
        this._target = options.target;
        this._generateContext = options.generateContext;
        this._join = options.join || {};
        this._processResults = options.processResults;
        this._defaultValue = options.defaultValue;
        this.parentJoinKeys = Object.keys(this._join);
    }
    
    parentJoinValues(parent) {
        return Object.keys(this._join).map(joinField => parent[joinField]);
    }
    
    fetch(request, context) {
        const childContext = this._generateContext(request, context);
        const childRequest = {...request, joinFields: values(this._join)};
        const results = this._target.fetch(childRequest, childContext);
        return new RelationshipResults({
            results,
            join: this._join,
            defaultValue: this._defaultValue,
            processResults: this._processResults
        });
    }
}

export class ObjectType {
    constructor(options) {
        this.fetchImmediates = options.fetchImmediates;
        this._generateFields = options.fields;
        this._fields = null;
    }
    
    fields() {
        if (this._fields === null) {
            this._fields = this._generateFields();
        }
        return this._fields;
    }
    
    fetch(request, context) {
        const fields = this.fields();

        const requestedFields = request.requestedFields;
        const [requestedRelationshipFields, requestedImmediateFields] = partition(
            requestedFields,
            field => fields[field] instanceof Relationship
        );

        const joinToChildrenFields = flatMap(requestedRelationshipFields, field => fields[field].parentJoinKeys);
        const fetchFields = uniq(requestedImmediateFields.concat(request.joinFields).concat(joinToChildrenFields));
        const immediatesRequest = {...request, requestedFields: fetchFields};
        const results = this.fetchImmediates(immediatesRequest, context);
        
        forEach(this.fields(), (field, fieldName) => {
            if (field instanceof Relationship) {
                const fieldRequest = request.children[fieldName];
                if (fieldRequest != null) {
                    const children = field.fetch(fieldRequest, context);
                    results.forEach(result => {
                        result[fieldName] = children.get(field.parentJoinValues(result));
                    });
                }
            }
        });
        
        return results.map(result => ({
            value: fromPairs(request.requestedFields.map(field => [field, result[field]])),
            joinValues: request.joinFields.map(joinField => result[joinField])
        }));
    }
}

export class RootObjectType extends ObjectType {
    constructor(options) {
        super({
            ...options,
            fetchImmediates: () => [{}]
        });
    }
}


function requestFromGraphqlAst(ast) {
    const children = graphqlChildren(ast);
    const requestedFields = Object.keys(children);
    
    return {
        args: fromPairs(map(ast.arguments, argument => [argument.name.value, argument.value.value])),
        children,
        requestedFields,
        joinFields: []
    };
}

function graphqlChildren(ast) {
    if (ast.selectionSet) {
        return fromPairs(ast.selectionSet.selections.map(selection =>
            [selection.name.value, requestFromGraphqlAst(selection)]
        ));
    } else {
        return [];
    }
}
