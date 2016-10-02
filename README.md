# GraphJoiner: Implementing GraphQL with joins

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
        {id: 1, title: "Leave It to Psmith", genre: "comedy", author_id: 1},
        {id: 2, title: "Right Ho, Jeeves", genre: "comedy", author_id: 1},
        {id: 3, title: "Catch-22", genre: "comedy", author_id: 2}
    ]).into("book"))
```

We then define types for the root, books and authors:

```javascript
import { JoinType, RootJoinType, field, single, many } from "graphjoiner";
import { fromPairs, mapKeys, zip } from "lodash";

const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({
                target: Book,
                select: args => {
                    let books = knex("book");

                    if ("genre" in args) {
                        books = books.where("genre", "=", args["genre"]);
                    }

                    return {query: books};
                },
                args: {genre: {type: GraphQLString}}
            })
        };
    }
});

function fetchImmediatesFromQuery(selections, {query}) {
    const requestedColumns = selections.map(selection => selection.field.columnName);
    const columnsToFields = fromPairs(zip(requestedColumns, selections.map(selection => selection.key)));
    return query.clone().select(requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}

const Book = new JoinType({
    name: "Book",

    fields() {
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            title: field({columnName: "title", type: GraphQLString}),
            genre: field({columnName: "genre", type: GraphQLString}),
            authorId: field({columnName: "author_id", type: GraphQLInt}),
            author: single({
                target: Author,
                select: (args, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.clone().distinct("book.author_id").as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                join: {"authorId": "id"}
           } )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});

const Author = new JoinType({
    name: "Author",

    fields() {
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            name: field({columnName: "name", type: GraphQLString})
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

Or by turning the types into ordinary GraphQL types:

```javascript
import { graphql, GraphQLSchema } from "graphql";

const schema = new GraphQLSchema({
    query: Root.toGraphQLType()
});

graphql(schema, query).then(result => result.data);
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
const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many({
                target: Book,
                select: args => {
                    let books = knex("book");

                    if ("genre" in args) {
                        books = books.where("genre", "=", args["genre"]);
                    }

                    return {query: books};
                },
                args: {genre: {type: GraphQLString}}
            })
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
const Book = new JoinType({
    name: "Book",

    fields() {
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            title: field({columnName: "title", type: GraphQLString}),
            genre: field({columnName: "genre", type: GraphQLString}),
            authorId: field({columnName: "author_id", type: GraphQLInt}),
            author: single({
                target: Author,
                select: (args, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.clone().distinct("book.author_id").as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                join: {"authorId": "id"}
            })
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
The value of `selections` in `fetchImmediates()`
is the requested fields that aren't defined as relationships
(using `single` or `many`) that were either explicitly requested in the
original GraphQL query, or are required as part of the join.

```javascript
function fetchImmediatesFromQuery(selections, {query}) {
    const requestedColumns = selections.map(selection => selection.field.columnName);
    const columnsToFields = fromPairs(zip(requestedColumns, selections.map(selection => selection.key)));
    return query.clone().select(requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}
```

For completeness, we can tweak the definition of `Author` so
we can request the books by an author:

```javascript
const Author = new JoinType({
    name: "Author",

    fields() {
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            name: field({columnName: "name", type: GraphQLString}),
            books: many({
                target: Book,
                select: (args, {query: authorQuery}) => ({
                    query: knex("book").join(
                        authorQuery.clone().distinct("author.id").as("author"),
                        "book.author_id",
                        "author.id"
                    )
                }),
                join: {"id": "authorId"}
            })
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});
```

(Note that when we return the Knex query, we return it wrapped in an object
i.e. `{query: query}`. This is to prevent the query from being executed, since
Knex queries also behave as promises (where `.then()` begins execution of the
query), and GraphJoiner allows promises to be returned from the various
methods where we might want to return a Knex query.)

## Installation

    npm install graphjoiner

## API

### `JoinType`

#### `new JoinType({name, fields, fetchImmediates})`

Create a new `JoinType`.

* `name`: the name of the type.

* `fields`: an object mapping names to each field.
  Each field should either be an immediate field created by `field()`,
  or a relationship to another type.

* `fetchImmediates(selections, select)`: a function to fetch the immediates for this type.
  `selections` is a list of objects with the properties:
    * `key`: the key of the selection.
      This is the alias specified in the GraphQL request,
      or the name of the field if no alias was specified.
    * `field`: the field of the selection.
      This will be one of the values passed in the `fields` property when
      constructing the `JoinType`.

  `fetchImmediates` should return a list of objects,
  where each object has a property named after the key of each selection.

### Fields

#### `field({type, ...props})`

Defines an immediate field.
At least `type` must be provided, which should be a GraphQL type such as `GraphQLString`.
All properties are available by the same name on the returned field.

#### `single({targetType, select, join, args})`

Create a one-to-one relationship.
The GraphQL type of the field will be the GraphQL type of `targetType`.

This takes a single object argument with the properties:

* `targetType` (required). The join type that this relationship joins to.

* `select(args, select)` (required).
  A function that generates the selector to be used when fetching instances of the target type for this field.

* `join` (optional): an object describing
  how to join together instances of the parent type and the target type.
  The keys should correspond to field names on the parent type,
  while the values should correspond to field names on the target type.

  For instance, suppose we're defining a `books` field on an `Author` type.
  If each book has an `authorId` field, and each author has an `id` field,
  then `join` should be `{"id": "authorId"}`.
  If not specified, GraphJoiner performs a cross join.

* `args` (optional): the arguments that may be passed to this field.
  This should be defined in the same way as arguments on an ordinary
  GraphQL field, such as `{genre: {type: GraphQLString}}`.

#### `many({targetType, select, join, args})`

Create a one-to-many relationship.
The GraphQL type of the field will be a list of the GraphQL type of `targetType`.
The arguments to `many()` are the same as those for `single()`.

#### `extract(relationship, fieldName)`

Given a relationship,
such as those returned by `single()` and `many()`,
create a new relationship that extracts a given field.

For instance, suppose an author type has a field `books` that describes all books by that author.
We can define a field `bookTitles` that describes the title of all books by that author
by calling `extract(books, "title")`:

```javascript
new JoinType({
    "Author",
    fields: {
        books: books,
        bookTitles: extract(books, "title")
    },
    fetchImmediates: ...
})
```

### `RootJoinType`

A `RootJoinType` behaves similarly to `JoinType`,
except that:

* there is always exactly one instance

* there are no immediate fields

As a result, there is no need to pass `fetchImmediates` when constructing
a `RootJoinType`.

