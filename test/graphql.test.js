import assert from "assert";

import { fromPairs } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, field, single, many, extract } from "../lib";
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

function fetchImmediatesFromObj(selections, objs) {
    function readObj(obj) {
        return fromPairs(selections.map(selection => [
            selection.key,
            obj[selection.field.name]
        ]));
    }
    return objs.map(readObj);
}

const Author = new JoinType({
    name: "Author",

    fields() {
        const books = many({
            target: Book,
            select: () => allBooks,
            join: {"id": "authorId"}
        });
        
        return {
            id: field({name: "id", type: GraphQLInt}),
            name: field({name: "name", type: GraphQLString}),
            books: books,
            bookTitles: extract(books, "title")
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});

const Book = new JoinType({
    name: "Book",

    fields() {
        const author = single({
            target: Author,
            select: () => allAuthors,
            join: {"authorId": "id"}
        });
        
        return {
            id: field({name: "id", type: GraphQLInt}),
            title: field({name: "title", type: GraphQLString}),
            authorId: field({name: "authorId", type: GraphQLInt}),
            author: author,
            booksBySameAuthor: extract(author, "books")
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});


const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({target: Book, select: () => allBooks}),
            "book": single({
                target: Book,
                select: args => {
                    let books = allBooks;

                    const bookId = args["id"];
                    if (bookId != null) {
                        books = books.filter(book => book.id === bookId);
                    }

                    return books;
                },
                args: {"id": {type: GraphQLInt}}
            }),
            "author": single({
                target: Author,
                select: args => {
                    let authors = allAuthors;

                    const authorId = args["id"];
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

function execute(query, options={}) {
    return graphql(schema, query, null, null, options.variables).then(result => {
        assert.equal(result.errors, undefined);
        return result.data;
    });
}

exports[module.filename] = testCases(execute);
