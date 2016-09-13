import Immutable from "immutable";

import { toListMap } from "./immutable";

/**
 * Given an array of results ({joinValues: Array, value: Any}), provides a
 * method `get(joinValues)` that returns all values that have the same
 * `joinValues`.
 *
 * All results and the arguments provided to `get()` should have the same
 * length of `joinValues`.
 */
export default class JoinMap {
    constructor(results) {
        this._results = toListMap(
            results,
            result => [Immutable.fromJS(result.joinValues), result.value]
        );
    }

    get(joinValues, defaultValue) {
        return this._results.get(Immutable.fromJS(joinValues), defaultValue);
    }
}
