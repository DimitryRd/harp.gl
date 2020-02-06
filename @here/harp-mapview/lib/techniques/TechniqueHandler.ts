/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Env, Expr, Geometry, Group, Technique, Value } from "@here/harp-datasource-protocol";
import { ViewRanges } from "@here/harp-datasource-protocol/lib/ViewRanges";
import { Projection } from "@here/harp-geoutils";
import { Tile } from "../Tile";

export interface TechniqueUpdateContext {
    /**
     * Expression evaluation environment containing variable bindings.
     */
    env: Env;

    frameNumber: number;

    viewRanges: ViewRanges;

    /**
     * Optional, cache of expression results.
     *
     * @see [[Expr.evaluate]]
     */
    cachedExprResults?: Map<Expr, Value>;

    projection: Projection;
}

export type TechniqueUpdater = (context: TechniqueUpdateContext) => void;

export interface TileObjectEntry {
    object: THREE.Object3D;
    tile: Tile;
}

export interface TechniqueHandler<T extends Technique> {
    technique: T;
    isShareableAcrossTiles: boolean;
    isDynamic: boolean;
    update(context: TechniqueUpdateContext): void;
}

export interface WorldTechniqueHandler<T extends Technique> extends TechniqueHandler<T> {
    createObject(tile: Tile, srcGeometry: Geometry, group: Group): THREE.Object3D[];
}

/*
export interface ScreenTechniqueHandler<T extends Technique> extends TechniqueHandler<T> {
    createObjects(
        tile: Tile,
        textPath:
    ): THREE.Object3D[];
}
*/

export type TechniqueHandlerContstructor<T extends Technique> = new (
    technique: T,
    tile: Tile,
    context: TechniqueUpdateContext
) => WorldTechniqueHandler<T>;

export const techniqueHandlers: {
    [name: string]: TechniqueHandlerContstructor<any>;
} = {};
