import { fromPairs, mapKeys, zip } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, single, many, extract, execute } from "../lib";
import { testCases } from "./executionTestCases";

import Knex from "knex";

let knex;

exports.beforeEach = () => {
    knex = Knex({
        dialect: "sqlite3",
        connection: {
            filename: ":memory:"
        },
        useNullAsDefault: true
    });

    return knex.schema
        .createTable("author", function(table) {
            table.increments("id");
            table.string("name");
        })
        .createTable("book", function(table) {
            table.increments("id");
            table.string("title");
            table.integer("author_id").unsigned().references("author.id")
        })
        .then(() => knex.insert([
            {id: 1, name: "PG Wodehouse"},
            {id: 2, name: "Joseph Heller"}
        ]).into("author"))
        .then(() => knex.insert([
            {id: 1, title: "Leave It to Psmith", author_id: 1},
            {id: 2, title: "Right Ho, Jeeves", author_id: 1},
            {id: 3, title: "Catch-22", author_id: 2}
        ]).into("book"));
};

const fetchImmediatesFromQuery = tableName => (request, {query}) => {
    const requestedColumns = request.selections.map(selection => tableName + "." + selection.field.columnName + " as " + selection.key);
    return query.clone().select(requestedColumns);
};

const Author = new JoinType({
    name: "Author",

    fields() {
        const books = many({
            target: Book,
            select: (request, {query: authorQuery}) => ({
                query: knex("book").join(
                    authorQuery.clone().distinct("author.id").as("author"),
                    "book.author_id",
                    "author.id"
                )
            }),
            join: {"id": "authorId"}
        });
        
        return {
            id: JoinType.field({columnName: "id", type: GraphQLInt}),
            name: JoinType.field({columnName: "name", type: GraphQLString}),
            books: books,
            bookTitles: extract(books, "title")
        };
    },

    fetchImmediates: fetchImmediatesFromQuery("author")
});

const Book = new JoinType({
    name: "Book",

    fields() {
        const author = single({
            target: Author,
            select: (request, {query: bookQuery}) => ({
                query: knex("author").join(
                    bookQuery.clone().select("book.author_id").distinct().as("book"),
                    "author.id",
                    "book.author_id"
                )
            }),
            join: {"authorId": "id"}
        });
        
        return {
            id: JoinType.field({columnName: "id", type: GraphQLInt}),
            title: JoinType.field({columnName: "title", type: GraphQLString}),
            authorId: JoinType.field({columnName: "author_id", type: GraphQLInt}),
            author: author,
            booksBySameAuthor: extract(author, "books")
        };
    },

    fetchImmediates: fetchImmediatesFromQuery("book")
});


const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({target: Book, select: () => ({query: knex("book")})}),
            "book": single({
                target: Book,
                select: request => {
                    let books = knex("book");

                    const bookId = request.args["id"];
                    if (bookId != null) {
                        books = books.where("id", "=", bookId);
                    }

                    return {query: books};
                },
                args: {"id": {type: GraphQLInt}}
            }),
            "author": single({
                target: Author,
                select: request => {
                    let authors = knex("author");

                    const authorId = request.args["id"];
                    if (authorId != null) {
                        authors = authors.where("id", "=", authorId);
                    }

                    return {query: authors};
                },
                args: {"id": {type: GraphQLInt}}
            })
        };
    }
});

exports[module.filename] = testCases((...args) => execute(Root, ...args));
