import { isEqual } from "lodash";

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
        this._results = results;
    }

    get(joinValues) {
        return this._results
            .filter(result => isEqual(result.joinValues, joinValues))
            .map(result => result.value);
    }
}
