import assert from "assert";

import JoinMap from "../lib/JoinMap";

exports["get() returns all values when join values are empty"] = () => {
    var map = new JoinMap([
        {joinValues: [], value: 1},
        {joinValues: [], value: 2}
    ]);

    assert.deepEqual(map.get([]), [1, 2]);
};

exports["get() returns all matching values when join values are singleton"] = () => {
    var map = new JoinMap([
        {joinValues: ["a"], value: 1},
        {joinValues: ["b"], value: 2},
        {joinValues: ["b"], value: 3}
    ]);

    assert.deepEqual(map.get(["a"]), [1]);
    assert.deepEqual(map.get(["b"]), [2, 3]);
};

exports["get() returns all matching values when there are multiple join values"] = () => {
    var map = new JoinMap([
        {joinValues: ["a", 1], value: 1},
        {joinValues: ["a", 2], value: 2},
        {joinValues: ["a", 2], value: 3},
        {joinValues: ["b", 1], value: 4},
        {joinValues: ["b", 2], value: 5}
    ]);

    assert.deepEqual(map.get(["a", 1]), [1]);
    assert.deepEqual(map.get(["a", 2]), [2, 3]);
    assert.deepEqual(map.get(["b", 1]), [4]);
    assert.deepEqual(map.get(["b", 2]), [5]);
};

exports["values are distinct by type"] = () => {
    var map = new JoinMap([
        {joinValues: ["1"], value: 1},
        {joinValues: [1], value: 2}
    ]);

    assert.deepEqual(map.get(["1"]), [1]);
    assert.deepEqual(map.get([1]), [2]);
};
