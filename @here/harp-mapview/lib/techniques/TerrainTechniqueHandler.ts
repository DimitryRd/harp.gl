/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

import { Geometry, Group, TerrainTechnique } from "@here/harp-datasource-protocol";
import { EarthConstants } from "@here/harp-geoutils";
import { MapMeshStandardMaterial } from "@here/harp-materials";
import { assert } from "@here/harp-utils";
import { createMaterial } from "../DecodedTileHelpers";
import { DisplacementMap, TileDisplacementMap } from "../DisplacementMap";
import { Tile } from "../Tile";
import {
    techniqueHandlers,
    TechniqueUpdateContext,
    TileObjectEntry,
    WorldTechniqueHandler
} from "./TechniqueHandler";
import { TechniqueHandlerCommon } from "./TechniqueHandlerCommon";

export class TerrainTechniqueHandler implements WorldTechniqueHandler<TerrainTechnique> {
    technique: TerrainTechnique;
    material: MapMeshStandardMaterial;

    objects: TileObjectEntry[] = [];

    isDynamic: boolean = false;
    isShareableAcrossTiles: boolean = false;

    constructor(technique: TerrainTechnique, tile: Tile, context: TechniqueUpdateContext) {
        // this.technique = fillDefaults(techniqe)
        this.technique = technique;
        this.material = createMaterial({ technique, env: context.env }) as MapMeshStandardMaterial;
        assert(this.material instanceof MapMeshStandardMaterial);

        const terrainColor = tile.mapView.clearColor;

        if (technique.displacementMap === undefined) {
            // Render terrain using the given color.
            this.material.color.set(terrainColor);
            return;
        }

        // Render terrain using height-based colors.
        this.material.onBeforeCompile = (shader: THREE.Shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <map_pars_fragment>",
                `#include <map_pars_fragment>
    uniform sampler2D displacementMap;
    uniform float displacementScale;
    uniform float displacementBias;`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <map_fragment>",
                `#ifdef USE_MAP
    float minElevation = ${EarthConstants.MIN_ELEVATION.toFixed(1)};
    float maxElevation = ${EarthConstants.MAX_ELEVATION.toFixed(1)};
    float elevationRange = maxElevation - minElevation;

    float disp = texture2D( displacementMap, vUv ).x * displacementScale + displacementBias;
    vec4 texelColor = texture2D( map, vec2((disp - minElevation) / elevationRange, 0.0) );
    texelColor = mapTexelToLinear( texelColor );
    diffuseColor *= texelColor;
#endif`
            );
            // We remove the displacement map from manipulating the vertices, it is
            // however still required for the pixel shader, so it can't be directly
            // removed.
            shader.vertexShader = shader.vertexShader.replace(
                "#include <displacementmap_vertex>",
                ""
            );
        };
        this.material.displacementMap!.needsUpdate = true;
    }

    createObject(tile: Tile, srcGeometry: Geometry, group?: Group) {
        const bufferGeometry = TechniqueHandlerCommon.createGenericBufferGeometry(
            this.technique,
            srcGeometry,
            group
        );
        const object = new THREE.Mesh(bufferGeometry, this.material);

        object.renderOrder = this.technique.renderOrder;

        this.objects.push({ object, tile });

        // NOTE:
        // This is copied wholesale from TileGeometryCreator.addUserData.
        //
        // TODO:
        // Why displacementMap is retroffitted into incompatible type ???
        // shouldn't we add specific field somewhere in Geometry/DecodedTile
        if ((srcGeometry.objInfos?.length ?? 0) > 0) {
            assert(
                Object.keys(object.userData).length === 0,
                "Unexpected user data in terrain object"
            );

            assert(
                typeof srcGeometry.objInfos![0] === "object",
                "Wrong attribute map type for terrain geometry"
            );

            const displacementMap = (srcGeometry.objInfos as DisplacementMap[])[0];
            const tileDisplacementMap: TileDisplacementMap = {
                tileKey: tile.tileKey,
                texture: new THREE.DataTexture(
                    displacementMap.buffer,
                    displacementMap.xCountVertices,
                    displacementMap.yCountVertices,
                    THREE.LuminanceFormat,
                    THREE.FloatType
                ),
                displacementMap,
                geoBox: tile.geoBox
            };
            object.userData = tileDisplacementMap;
        }

        return [object];
    }

    update() {
        /* noop, we're completly static */
    }
}

techniqueHandlers.terrain = TerrainTechniqueHandler;
