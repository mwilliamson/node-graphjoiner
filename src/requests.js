import { keyBy, map } from "lodash";
import { getArgumentValues } from "graphql/execution/values";

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
            const fieldSelections = collectFields(ast);
            
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
        ast.selectionSet.selections.forEach(selection => {
            if (selection.kind === "Field") {
                fieldSelections.push(selection);
            } else if (selection.kind === "FragmentSpread") {
                // TODO: handle type conditions
                addFields(fragments[selection.name.value], fieldSelections);
            } else {
                throw new Error("Unknown selection: " + selection.kind);
            }
        });
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
