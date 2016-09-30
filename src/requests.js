import { cloneDeep, keyBy, map } from "lodash";
import { getArgumentValues } from "graphql/execution/values";
import { GraphQLIncludeDirective, GraphQLSkipDirective } from "graphql/type/directives";

export function requestFromGraphqlDocument(document, root, variables) {
    function definitionsOfKind(kind) {
        return document.definitions.filter(definition => definition.kind === kind);
    }
    
    const fragments = keyBy(
        definitionsOfKind("FragmentDefinition"),
        definition => definition.name.value
    );
    
    const query = single(definitionsOfKind("OperationDefinition"));
    
    return requestFromGraphqlAst(query, root, null, variables, fragments);
}

export function requestFromGraphqlAst(ast, root, field, variables, fragments) {
    return reader(variables, fragments)(ast, root, field);
}

function reader(variables, fragments) {
    function readAst(ast, root, field) {
        const isField = ast.kind === "Field";
        return createRequest({
            field: field,
            key: isField ? requestedFieldKey(ast) : null,
            args: graphqlArgs(ast, field),
            selections: graphqlSelections(ast, root)
        });
    }
    
    function graphqlArgs(ast, field) {
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

    function graphqlSelections(ast, root) {
        if (ast.selectionSet) {
            const fields = root.fields();
            const fieldSelections = mergeFields(collectFields(ast));
            
            return fieldSelections.map(selection => {
                const field = fields[requestedFieldName(selection)];
                return readAst(selection, field._target, field);
            });
        } else {
            return [];
        }
    }
    
    function collectFields(ast) {
        const fieldSelections = [];
        addFields(ast, fieldSelections);
        return fieldSelections;
    }
    
    function addFields(ast, fieldSelections) {
        ast.selectionSet.selections.filter(shouldIncludeNode).forEach(selection => {
            if (selection.kind === "Field") {
                fieldSelections.push(selection);
            } else if (selection.kind === "FragmentSpread") {
                // TODO: handle type conditions
                addFields(fragments[selection.name.value], fieldSelections);
            } else if (selection.kind === "InlineFragment") {
                addFields(selection, fieldSelections);
            } else {
                throw new Error("Unknown selection: " + selection.kind);
            }
        });
    }
    
    function shouldIncludeNode(node) {
        for (let directiveIndex = 0; directiveIndex < node.directives.length; directiveIndex++) {
            const directive = node.directives[directiveIndex];
            if (directive.name.value === "include") {
                const args = getArgumentValues(
                    GraphQLIncludeDirective.args,
                    directive.arguments,
                    variables
                );
                if (args.if === false) {
                    return false;
                }
            } else if (directive.name.value === "skip") {
                const args = getArgumentValues(
                    GraphQLSkipDirective.args,
                    directive.arguments,
                    variables
                );
                if (args.if === true) {
                    return false;
                }
            } else {
                throw new Error("Unknown directive: " + directive.name.value);
            }
        }
        return true;
    }
    
    function mergeFields(selections) {
        const merged = [];
        const byKey = {};
        
        selections.forEach(selection => {
            const key = requestedFieldKey(selection);
            if (byKey[key]) {
                if (selection.selectionSet) {
                    byKey[key].selectionSet.selections.push(...selection.selectionSet.selections);
                }
            } else {
                byKey[key] = cloneDeep(selection);
                merged.push(byKey[key]);
            }
        });
        
        return merged;
    }
    
    return readAst;
}

export function createRequest(request) {
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

export function requestedFieldKey(ast) {
    return ast.alias ? ast.alias.value : requestedFieldName(ast);
}

function single(values) {
    if (values.length === 1) {
        return values[0];
    } else {
        throw new Error("Expected 1 but got " + values.length);
    }
}
