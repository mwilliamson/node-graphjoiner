import { flatMap, forEach, fromPairs, map, mapValues, partition, toPairs, zip } from "lodash";
import { parse } from "graphql/language";
import { getArgumentValues } from "graphql/execution/values";
import { GraphQLObjectType, GraphQLList } from "graphql";

import JoinMap from "./JoinMap";

export function execute(root, query, options={}) {
    const request = requestFromGraphqlAst(parse(query).definitions[0], root, null, options.variables);
    return executeRequest(root, request);
}

function executeRequest(root, request) {
    return Promise.resolve(root.fetch(request)).then(result => result[0].value);
}

export function many({target, select, join, args}={}) {
    return new Relationship({
        target,
        select,
        join,
        args,
        processResults: x => x,
        wrapType: type => new GraphQLList(type)
    });
}

export function single({target, select, join, args}={}) {
    return new Relationship({
        target,
        select,
        join,
        args,
        processResults: singleValue,
        wrapType: type => type
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

class RelationshipResults {
    constructor(options) {
        this._results = new JoinMap(options.results);
        this._processResults = options.processResults;
        this._parentJoinKeys = options.parentJoinKeys;
    }

    get(parent) {
        const parentJoinValues = this._parentJoinValues(parent);
        const values = this._results.get(parentJoinValues, []);
        return this._processResults(values);
    }

    _parentJoinValues(parent) {
        return this._parentJoinKeys.map(joinField => parent[joinField]);
    }
}

class Relationship {
    constructor(options) {
        this._target = options.target;
        this._select = options.select;
        this._join = options.join || {};
        this.args = options.args || {};
        this._processResults = options.processResults;
        this._wrapType = options.wrapType;
        this._parentJoinKeys = map(this._join, (childKey, parentKey) => "_graphjoiner_joinToChildrenKey_" + parentKey);
    }
    
    parentJoinSelections(parent) {
        const fields = parent.fields();
        return zip(map(this._join, (childKey, parentKey) => parentKey), this._parentJoinKeys).map(([fieldName, key]) => (createRequest({
            field: fields[fieldName],
            key: key
        })));
    }

    fetch(request, selectParent) {
        const joinFields = this._target.joinFields();
        const childRequest = {
            ...request,
            joinSelections: map(this._join, childKey => createRequest({
                field: joinFields[childKey],
                key: "_graphjoiner_joinToParentKey_" + childKey
            }))
        };
        return Promise.resolve(this._select(request, selectParent)).then(select =>
            this._target.fetch(childRequest, select)
        )
        .then(results =>
            new RelationshipResults({
                results,
                parentJoinKeys: this._parentJoinKeys,
                processResults: this._processResults
            })
        );
    }

    toGraphQLField() {
        // TODO: differentiate between root and non-root types properly
        const resolve = Object.keys(this._join).length !== 0 ? resolveField : (source, args, context, info) => {
            const request = requestFromGraphqlAst(info.fieldASTs[0], this._target, this, info.variableValues);
            return this.fetch(request, null).then(results => results.get([]));
        };
        return {
            type: this._wrapType(this._target.toGraphQLType()),
            resolve: resolve,
            args: this.args
        };
    }
}

export function extract(relationship, fieldName) {
    return new Relationship({
        target: new ScalarJoinType(relationship._target, fieldName),
        processResults: relationship._processResults,
        wrapType: relationship._wrapType,
        select: relationship._select,
        join: relationship._join,
        args: relationship.args,
    });
}

class ScalarJoinType {
    constructor(target, fieldName) {
        this._target = target;
        this._fieldName = fieldName;
    }
    
    get _field() {
        return this._target.fields()[this._fieldName];
    }
    
    fields() {
        if (this._field instanceof Relationship) {
            return this._field._target.fields();
        } else {
            return {};
        }
    }
    
    joinFields() {
        return this._target.joinFields();
    }
    
    fetch(request, select) {
        const fieldRequest = createRequest({
            key: this._fieldName,
            field: this._field,
            selections: request.selections,
            context: request.context
        });
        return this._target.fetch({...request, selections: [fieldRequest]}, select).then(results =>
            results.map(result => ({
                value: result.value[this._fieldName],
                joinValues: result.joinValues
            }))
        );
    }
    
    toGraphQLType() {
        return this._field.toGraphQLField().type;
    }
}

export class JoinType {
    constructor(options) {
        this._name = options.name;
        this.fetchImmediates = options.fetchImmediates;
        this._generateFields = options.fields;
        this._fields = null;
    }

    fields() {
        if (this._fields === null) {
            // TODO: add name to field definitions?
            this._fields = this._generateFields();
        }
        return this._fields;
    }
    
    joinFields() {
        return this.fields();
    }

    fetch(request, select) {
        const fields = this.fields();

        const [relationshipSelections, requestedImmediateSelections] = partition(
            request.selections,
            selection => selection.field instanceof Relationship
        );
        
        const joinToChildrenSelections = flatMap(
            relationshipSelections,
            selection => selection.field.parentJoinSelections(this)
        );
        const immediateSelections = requestedImmediateSelections.concat(request.joinSelections).concat(joinToChildrenSelections);
        const immediatesRequest = {...request, selections: immediateSelections};
        return Promise.resolve(this.fetchImmediates(immediatesRequest, select)).then(results => {
            return Promise.all(map(relationshipSelections, fieldRequest => {
                return fieldRequest.field.fetch(fieldRequest, select).then(children => {
                    results.forEach(result => {
                        result[fieldRequest.key] = children.get(result);
                    })
                });
            })).then(() => results.map(result => ({
                value: fromPairs(request.selections.map(selection => [selection.key, result[selection.key]])),
                joinValues: request.joinSelections.map(selection => result[selection.key])
            })));
        });
    }

    toGraphQLType() {
        if (!this._graphQLType) {
            this._graphQLType = new GraphQLObjectType({
                name: this._name,
                fields: () => mapValues(this.fields(), field => field.toGraphQLField())
            });
        }
        return this._graphQLType;
    }
}

JoinType.field = function field(options) {
    return {
        ...options,
        toGraphQLField() {
            return {
                type: options.type,
                resolve: resolveField
            };
        }
    };
};

function resolveField(source, args, context, info) {
    return source[requestedFieldKey(info.fieldASTs[0])];
}

export class RootJoinType extends JoinType {
    constructor(options) {
        super({
            ...options,
            fetchImmediates: () => [{}]
        });
    }
}

function requestFromGraphqlAst(ast, root, field, variables) {
    const isField = ast.kind === "Field";
    return createRequest({
        field: field,
        key: isField ? requestedFieldKey(ast) : null,
        args: graphqlArgs(ast, field, variables),
        selections: graphqlSelections(ast, root, variables)
    });
}

function graphqlArgs(ast, field, variables) {
    if (field) {
        const argumentDefinitions = map(field.args, (arg, argName) => ({
            name: argName,
            description: arg.description === undefined ? null : arg.description,
            type: arg.type,
            defaultValue: arg.defaultValue === undefined ? null : arg.defaultValue
        }));
        return getArgumentValues(argumentDefinitions, ast.arguments, variables);
    } else {
        return {};
    }
}

function graphqlSelections(ast, root, variables) {
    if (ast.selectionSet) {
        const fields = root.fields();
        return ast.selectionSet.selections.map(selection => {
            const field = fields[requestedFieldName(selection)];
            return requestFromGraphqlAst(selection, field._target, field, variables);
        });
    } else {
        return [];
    }
}

function createRequest(request) {
    return {
        field: null,
        args: {},
        selections: [],
        joinSelections: [],
        ...request
    };
}

function requestedFieldName(ast) {
    return ast.name.value;
}

function requestedFieldKey(ast) {
    return ast.alias ? ast.alias.value : requestedFieldName(ast);
}
