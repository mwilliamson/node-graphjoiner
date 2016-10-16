import { fromPairs, map, mapKeys, mapValues, zip } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";
import sqlite3 from "sqlite3";
import Promise from "bluebird";
import sql from "sql-gen";

import { JoinType, RootJoinType, field, single, many, extract, execute } from "../lib";
import { testCases } from "./executionTestCases";

let db;

function executeSql(query) {
    const {text, params} = sql.compile(query);
    return Promise.fromCallback(callback => {
        if (/SELECT/.test(text)) {
            db.all(text, ...params, callback);
        } else {
            db.run(text, ...params, callback);
        }
    });
}

const AuthorTable = sql.table("author", {
    id: sql.column({name: "id", type: sql.types.int, primaryKey: true}),
    name: sql.column({name: "name", type: sql.types.string})
});

const BookTable = sql.table("book", {
    id: sql.column({name: "id", type: sql.types.int, primaryKey: true}),
    title: sql.column({name: "title", type: sql.types.string}),
    authorId: sql.column({name: "author_id", type: sql.types.int})
});


function insertAuthor({id, name}) {
    db.run("INSERT INTO author (id, name) VALUES (?, ?)", id, name);
}

function insertBook({id, title, authorId}) {
    db.run("INSERT INTO book (id, title, author_id) VALUES (?, ?, ?)", id, title, authorId);
}

exports.before = () => {
    db = new sqlite3.Database(':memory:');
    db.serialize(() => {
        executeSql(sql.createTable(AuthorTable));
        executeSql(sql.createTable(BookTable));
        insertAuthor({id: 1, name: "PG Wodehouse"});
        insertAuthor({id: 2, name: "Joseph Heller"});
        insertBook({id: 1, title: "Leave It to Psmith", authorId: 1});
        insertBook({id: 2, title: "Right Ho, Jeeves", authorId: 1});
        insertBook({id: 3, title: "Catch-22", authorId: 2});
    });
};

const fetchImmediatesFromQuery = table => (selections, sqlQuery) => {
    const requestedColumns = selections.map(selection => table.c[selection.field.columnName].as(selection.key));
    const primaryKeyColumns = table.primaryKey.columns
        .map(column => column.as("_primaryKey_" + column.key()));
    const columns = requestedColumns.concat(primaryKeyColumns);
    const immediatesQuery = sqlQuery.select(...columns).distinct();
    return executeSql(immediatesQuery);
};

const Author = new JoinType({
    name: "Author",

    fields() {
        const books = many({
            target: Book,
            select: (args, authorSqlQuery) => {
                const authors = authorSqlQuery.select(AuthorTable.c.id).subquery();
                return sql.from(BookTable).join(authors, sql.eq(authors.c.id, BookTable.c.authorId));
            },
            join: {"id": "authorId"}
        });
        
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            name: field({columnName: "name", type: GraphQLString}),
            books: books,
            bookTitles: extract(books, "title")
        };
    },

    fetchImmediates: fetchImmediatesFromQuery(AuthorTable)
});

const Book = new JoinType({
    name: "Book",

    fields() {
        const author = single({
            target: Author,
            select: (args, bookSqlQuery) => {
                const books = bookSqlQuery.select(BookTable.c.authorId).subquery();
                return sql.from(AuthorTable).join(books, sql.eq(books.c.authorId, AuthorTable.c.id));
            },
            join: {"authorId": "id"}
        });
        
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            title: field({columnName: "title", type: GraphQLString}),
            authorId: field({columnName: "authorId", type: GraphQLInt}),
            author: author,
            booksBySameAuthor: extract(author, "books")
        };
    },

    fetchImmediates: fetchImmediatesFromQuery(BookTable)
});


const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({target: Book, select: () => sql.from(BookTable)}),
            "book": single({
                target: Book,
                select: args => {
                    let books = sql.from(BookTable);

                    const bookId = args["id"];
                    if (bookId != null) {
                        books = books.where(sql.eq(BookTable.c.id, bookId));
                    }

                    return books;
                },
                args: {"id": {type: GraphQLInt}}
            }),
            "author": single({
                target: Author,
                select: args => {
                    let authors = sql.from(AuthorTable);

                    const authorId = args["id"];
                    if (authorId != null) {
                        authors = authors.where(sql.eq(AuthorTable.c.id, authorId));
                    }

                    return authors;
                },
                args: {"id": {type: GraphQLInt}}
            })
        };
    }
});

exports[module.filename] = testCases((...args) => execute(Root, ...args));
