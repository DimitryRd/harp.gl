/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedTechnique, Technique } from "@here/harp-datasource-protocol";
import { assert } from "@here/harp-utils";
import { Tile } from "../Tile";
import {
    TechniqueHandler,
    techniqueHandlers,
    TechniqueUpdateContext,
    WorldTechniqueHandler
} from "./TechniqueHandler";

import "./ExtrudedPolygonTechniqueHandler";
import "./FillTechniqueHandler";
import "./SolidLineTechniqueHandler";
import "./TerrainTechniqueHandler";

export class TechniqueHandlerPool {
    pool: Map<string, TechniqueHandler<Technique>> = new Map();

    constructor() {
        /** no op */
    }

    canHandle(technique: Technique) {
        return technique.name in techniqueHandlers;
    }

    getTechniqueHandler<T extends IndexedTechnique>(
        technique: T,
        tile: Tile,
        context: TechniqueUpdateContext
    ): WorldTechniqueHandler<T> {
        // Yes, i know.
        const key = technique._key;
        let handler = this.pool.get(key);
        if (handler === undefined) {
            const techniqueHandlerCtor = techniqueHandlers[technique.name];
            if (!techniqueHandlerCtor) {
                throw new Error(`unknown technique ${technique.name}`);
            }
            handler = new techniqueHandlerCtor(technique, tile, context);

            // TODO: isShareable should be static trait derivable from `T` only

            // TODO: isShareable was designed as isShareableAcrossTiles, now we're only maybe
            // sharing stuff between one tile
            if (handler.isShareableAcrossTiles) {
                this.pool.set(key, handler);
            }
            //this.pool.set(key, handler);
        }
        // TODO: text technique handler and world space technique handler doesn't
        // share common interface, what now ?

        assert(typeof (handler as WorldTechniqueHandler<T>).createObject === "function");
        return handler as WorldTechniqueHandler<T>;
    }

    reset() {
        this.pool.clear();
    }
}
