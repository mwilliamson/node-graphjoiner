import { fromPairs } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, single, many, execute } from "../lib";
import { testCases } from "./executionTestCases";

const allAuthors = [
    {id: 1, name: "PG Wodehouse"},
    {id: 2, name: "Joseph Heller"}
];

const allBooks = [
    {id: 1, title: "Leave It to Psmith", authorId: 1},
    {id: 2, title: "Right Ho, Jeeves", authorId: 1},
    {id: 3, title: "Catch-22", authorId: 2}
];

function fetchImmediatesFromObj(request, objs) {
    const requestedProperties = request.selection.map(field => this.fields()[field.fieldName].name);

    function readObj(obj) {
        return fromPairs(requestedProperties.map(property => [property, obj[property]]));
    }
    return objs.map(readObj);
}

const Author = new JoinType({
    name: "Author",

    fields() {
        return {
            id: JoinType.field({name: "id", type: GraphQLInt}),
            name: JoinType.field({name: "name", type: GraphQLString}),
            books: many({
                target: Book,
                select: () => allBooks,
                join: {"id": "authorId"}
            })
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});

const Book = new JoinType({
    name: "Book",

    fields() {
        return {
            id: JoinType.field({name: "id", type: GraphQLInt}),
            title: JoinType.field({name: "title", type: GraphQLString}),
            authorId: JoinType.field({name: "authorId", type: GraphQLInt}),
            author: single({
                target: Author,
                select: () => allAuthors,
                join: {"authorId": "id"}
            })
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});


const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({target: Book, select: () => allBooks}),
            "author": single({
                target: Author,
                select: request => {
                    let authors = allAuthors;

                    // TODO: remove the need to parseInt
                    const authorId = parseInt(request.args["id"], 10);
                    if (authorId != null) {
                        authors = authors.filter(author => author.id === authorId);
                    }

                    return authors;
                }
            })
        };
    }
});

exports[module.filename] = testCases(query => execute(Root, query));
