import { map } from "lodash";
import { getArgumentValues } from "graphql/execution/values";

export function requestFromGraphqlDocument(document, root, field, variables) {
    return requestFromGraphqlAst(document.definitions[0], root, field, variables);
}

export function requestFromGraphqlAst(ast, root, field, variables) {
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
