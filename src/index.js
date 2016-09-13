import { flatMap, forEach, fromPairs, map, partition, toPairs, uniq } from "lodash";
import { parse } from "graphql/language";

import JoinMap from "./JoinMap";

export function execute(root, query) {
    const request = requestFromGraphqlAst(parse(query).definitions[0]);
    return Promise.resolve(root.fetch(request)).then(result => result[0].value);
}

export function many(target, generateContext, join) {
    return new Relationship({
        target,
        generateContext,
        join,
        processResults: x => x
    });
}

export function single(target, generateContext, join) {
    return new Relationship({
        target,
        generateContext,
        join,
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
        this._generateContext = options.generateContext;
        this._join = toPairs(options.join || {});
        this._processResults = options.processResults;
        this.parentJoinKeys = this._join.map(pair => pair[0]);
    }

    fetch(request, context) {
        const childRequest = {...request, joinFields: this._join.map(pair => pair[1])};
        return Promise.resolve(this._generateContext(request, context)).then(childContext =>
            this._target.fetch(childRequest, childContext)
        )
        .then(results =>
            new RelationshipResults({
                results,
                parentJoinKeys: this.parentJoinKeys,
                processResults: this._processResults
            })
        );
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
        return Promise.resolve(this.fetchImmediates(immediatesRequest, context)).then(results => {
            return Promise.all(map(this.fields(), (field, fieldName) => {
                if (field instanceof Relationship) {
                    const fieldRequest = request.children[fieldName];
                    if (fieldRequest != null) {
                        return field.fetch(fieldRequest, context).then(children => {
                            results.forEach(result => {
                                result[fieldName] = children.get(result);
                            })
                        });
                    }
                }
            })).then(() => results.map(result => ({
                value: fromPairs(request.requestedFields.map(field => [field, result[field]])),
                joinValues: request.joinFields.map(joinField => result[joinField])
            })));
        });
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
