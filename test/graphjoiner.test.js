import { fromPairs } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, single, many, extract, execute } from "../lib";
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
        const books = many({
            target: Book,
            select: () => allBooks,
            join: {"id": "authorId"}
        });
        return {
            id: JoinType.field({name: "id", type: GraphQLInt}),
            name: JoinType.field({name: "name", type: GraphQLString}),
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
            id: JoinType.field({name: "id", type: GraphQLInt}),
            title: JoinType.field({name: "title", type: GraphQLString}),
            authorId: JoinType.field({name: "authorId", type: GraphQLInt}),
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
                select: request => {
                    let books = allBooks;

                    const bookId = request.args["id"];
                    if (bookId != null) {
                        books = books.filter(book => book.id === bookId);
                    }

                    return books;
                },
                args: {"id": {type: GraphQLInt}}
            }),
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

exports[module.filename] = testCases((...args) => execute(Root, ...args));
