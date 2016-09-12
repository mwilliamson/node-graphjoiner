# GraphJoiner: Implementing GraphQL with joins

In some use cases, I've found it more natural to generate the requested GraphQL
data using SQL joins rather than resolving values individually. This is a proof
of concept that provides an alternative way of responding to GraphQL queries.

In the reference GraphQL implementation, resolve functions describe how to
fulfil some part of the requested data for each instance of an object.
If implemented naively with a SQL backend, this results in the N+1 problem.
For instance, given the query:

    {
        books(genre: "comedy") {
            title
            author {
                name
            }
        }
    }

A naive GraphQL implement would issue one SQL query to get the list of all
books in the comedy genre, and then N queries to get the author of each book
(where N is the number of books returned by the first query).

There are various solutions proposed to this problem: GraphJoiner suggests that
using joins is a natural fit for many use cases. For this specific case, we only
need to run two queries: one to find the list of all books in the comedy genre,
and one to get the authors of books in the comedy genre.

## Example

Let's say we have a SQL database which we access using Knex.
A book has an ID, a title and an author ID.
An author has an ID and a name.

```javascript
import Knex from "knex";

let knex = Knex({
    dialect: "sqlite3",
    connection: {
        filename: ":memory:"
    },
    useNullAsDefault: true
});

knex.schema
    .createTable("author", function(table) {
        table.increments("id");
        table.string("name");
    })
    .createTable("book", function(table) {
        table.increments("id");
        table.string("title");
        table.string("genre");
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
    ]).into("book"))
```

We then define object types for the root, books and authors:

```javascript
import { ObjectType, RootObjectType, single, many } from "graphjoiner";
import { invert, mapKeys } from "lodash";

const Root = new RootObjectType({
    name: "Query",

    fields() {
        return {
            "books": many(Book, request => {
                let books = knex("book");

                if ("genre" in request.args) {
                    books = books.where("genre", "=", request.args["genre"]);
                }

                return {query: books};
            }
        };
    }
});

function fetchImmediatesFromQuery(request, {query}) {
    const fields = this.fields();
    const columnsToFields = invert(fields);
    const requestedColumns = request.requestedFields.map(field => fields[field]);
    return query.select(request.requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}

const Book = new ObjectType({
    name: "Book",

    fields() {
        return {
            id: "id",
            title: "title",
            genre: "genre",
            authorId: "author_id",
            author: single(
                Author,
                (request, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.select("book.author_id").distinct().as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                {"authorId": "id"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});

const Author = new ObjectType({
    name: "Author",

    fields() {
        return {
            id: "id",
            name: "name"
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});
```

We can execute the query by calling `execute`:

```javascript

import { execute } from "graphjoiner";

const query = `
    {
        books(genre: "comedy") {
            title
            author {
                name
            }
        }
    }
`;
execute(Root, query)
```

Which produces:

    {
        "books": [
            {
                "title": "Leave It to Psmith",
                "author": {
                    "name": "PG Wodehouse"
                }
            },
            {
                "title": "Right Ho, Jeeves",
                "author": {
                    "name": "PG Wodehouse"
                }
            },
            {
                "title": "Catch-22",
                "author": {
                    "name": "Joseph Heller"
                }
            },
        ]
    }

Let's break things down a little, starting with the definition of the root object:

```javascript
const Root = new RootObjectType({
    name: "Query",

    fields() {
        return {
            "books": many(Book, request => {
                let books = knex("book");

                if ("genre" in request.args) {
                    books = books.where("genre", "=", request.args["genre"]);
                }

                return {query: books};
            }
        };
    }
});
```

For each object type, we need to define its fields.
The root has only one field, `books`, a one-to-many relationship,
which we define using `many()`.
The first argument, `Book`,
is the object type we're defining a relationship to.
The second argument to describes how to create a query representing all of those
related books: in this case all books, potentially filtered by a genre argument.

This means we need to define `Book`:

```javascript
const Book = new ObjectType({
    name: "Book",

    fields() {
        return {
            id: "id",
            title: "title",
            genre: "genre",
            authorId: "author_id",
            author: single(
                Author,
                (request, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.select("book.author_id").distinct().as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                {"authorId": "id"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});
```

The `author` field is defined as a one-to-one mapping from book to author.
As before, we define a function that generates a query for the requested authors.
We also provide a `join` argument to `single()` so that GraphJoiner knows
how to join together the results of the author query and the book query:
in this case, the `authorId` field on books corresponds to the `id` field
on authors.
(If we leave out the `join` argument, then GraphJoiner will perform a cross
join i.e. a cartesian product. Since there's always exactly one root instance,
this is fine for relationships defined on the root.)

The remaining fields define a mapping from the GraphQL field to the database
column. This mapping is handled by `fetchImmediatesFromQuery()`.
The value of `request.requested_fields` in `fetchImmediates()`
is the fields that aren't defined as relationships
(using `single` or `many`) that were either explicitly requested in the
original GraphQL query, or are required as part of the join.

```javascript
function fetchImmediatesFromQuery(request, {query}) {
    const fields = this.fields();
    const columnsToFields = invert(fields);
    const requestedColumns = request.requestedFields.map(field => fields[field]);
    return query.select(request.requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}
```

For completeness, we can tweak the definition of `Author` so
we can request the books by an author:

```javascript
const Author = new ObjectType({
    name: "Author",

    fields() {
        return {
            id: "id",
            name: "name",
            books: many(
                Book,
                (request, {query: authorQuery}) => ({
                    query: knex("book").join(
                        authorQuery.select("author.id").distinct().as("author"),
                        "book.author_id",
                        "author.id"
                    )
                }),
                {"id": "authorId"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});
```

Installation
------------

    npm install graphjoiner

