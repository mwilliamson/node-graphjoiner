import assert from "assert";

import { fromPairs } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, single, many } from "../lib";
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
    function readObj(obj) {
        return fromPairs(request.selections.map(selection => [
            selection.key,
            obj[selection.field.name]
        ]));
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

                    const authorId = request.args["id"];
                    if (authorId != null) {
                        authors = authors.filter(author => author.id === authorId);
                    }

                    return authors;
                },
                args: {"id": {type: GraphQLInt}}
            })
        };
    }
});

const schema = new GraphQLSchema({
    // TODO: we should make sure we only do this on root types (or rather,
    // those without immediate fields and no join keys on fields).
    query: Root.toGraphQLType()
});

function execute(query) {
    return graphql(schema, query).then(result => {
        assert.equal(result.errors, undefined);
        return result.data;
    });
}

exports[module.filename] = testCases(execute);
