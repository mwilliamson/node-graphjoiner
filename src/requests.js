import { map } from "lodash";
import { getArgumentValues } from "graphql/execution/values";

export function requestFromGraphqlDocument(document, root, field, variables) {
    return requestFromGraphqlAst(document.definitions[0], root, field, variables);
}

export function requestFromGraphqlAst(ast, root, field, variables) {
    return reader(variables)(ast, root, field);
}

function reader(variables) {
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
            return ast.selectionSet.selections.map(selection => {
                const field = fields[requestedFieldName(selection)];
                return readAst(selection, field._target, field);
            });
        } else {
            return [];
        }
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
