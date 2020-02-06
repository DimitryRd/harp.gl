/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

import { Expr, FillTechnique, Geometry, Group } from "@here/harp-datasource-protocol";
import { EdgeMaterial, EdgeMaterialParameters, MapMeshBasicMaterial } from "@here/harp-materials";
import { assert } from "@here/harp-utils";
import {
    applyBaseColorToMaterial,
    createMaterial,
    getBufferAttribute
} from "../DecodedTileHelpers";
import { Tile } from "../Tile";
import { techniqueHandlers, TechniqueUpdateContext, TileObjectEntry } from "./TechniqueHandler";
import { GenericTechniqueHandler, TechniqueHandlerCommon } from "./TechniqueHandlerCommon";

export class FillTechniqueHandler extends GenericTechniqueHandler<FillTechnique> {
    mainMaterial: MapMeshBasicMaterial;

    outlineMaterial?: EdgeMaterial;

    mainObjects: TileObjectEntry[] = [];
    outlineObjects: TileObjectEntry[] = [];

    constructor(technique: FillTechnique, tile: Tile, context: TechniqueUpdateContext) {
        // this.technique = fillDefaults(techniqe)
        super(technique);
        this.mainMaterial = createMaterial({ technique, env: context.env }) as MapMeshBasicMaterial;
        assert(this.mainMaterial instanceof MapMeshBasicMaterial);

        if (Expr.isExpr(technique.color) || Expr.isExpr(technique.opacity)) {
            this.updaters.push(
                TechniqueHandlerCommon.updateBaseColor.bind(
                    undefined,
                    this.mainMaterial,
                    this.mainObjects,
                    technique
                )
            );
        }

        const fadingParams = TechniqueHandlerCommon.getPolygonFadingParams(technique, context.env);
        if (TechniqueHandlerCommon.isFadingFeatureEnabled(fadingParams)) {
            this.updaters.push(
                TechniqueHandlerCommon.updateFadingParams.bind(
                    undefined,
                    this.mainMaterial,
                    fadingParams
                )
            );
        }

        if (
            Expr.isExpr(technique.lineWidth) ||
            (typeof technique.lineWidth === "number" && technique.lineWidth > 0)
        ) {
            const materialParams: EdgeMaterialParameters = {
                color: fadingParams.color,
                colorMix: fadingParams.colorMix,
                fadeNear: fadingParams.lineFadeNear,
                fadeFar: fadingParams.lineFadeFar
            };
            this.outlineMaterial = new EdgeMaterial(materialParams);

            if (TechniqueHandlerCommon.isFadingFeatureEnabled(fadingParams)) {
                this.updaters.push(
                    TechniqueHandlerCommon.updateEdgeFadingParams.bind(
                        undefined,
                        this.outlineMaterial,
                        fadingParams
                    )
                );
            }

            if (Expr.isExpr(technique.lineColor) || Expr.isExpr(technique.opacity)) {
                this.updaters.push(this.updateLineColor.bind(this));
            }
        }
    }

    createObject(tile: Tile, srcGeometry: Geometry, group?: Group) {
        const bufferGeometry = TechniqueHandlerCommon.createGenericBufferGeometry(
            this.technique,
            srcGeometry,
            group
        );
        const mainObject = new THREE.Mesh(bufferGeometry, this.mainMaterial);

        TechniqueHandlerCommon.setupUserData(srcGeometry, this.technique, mainObject);

        mainObject.renderOrder = this.technique.renderOrder;

        this.mainObjects.push({ object: mainObject, tile });

        if (this.outlineMaterial && srcGeometry.edgeIndex) {
            const outlineGeometry = new THREE.BufferGeometry();
            outlineGeometry.setAttribute("position", bufferGeometry.getAttribute("position"));
            outlineGeometry.setIndex(getBufferAttribute(srcGeometry.edgeIndex!));

            const secondaryObject = new THREE.LineSegments(outlineGeometry, this.outlineMaterial);

            secondaryObject.renderOrder = mainObject.renderOrder + 0.1;

            this.outlineObjects.push({ object: secondaryObject, tile });

            return [mainObject, secondaryObject];
        }
        return [mainObject];
    }

    private updateLineColor(context: TechniqueUpdateContext) {
        assert(this.outlineMaterial !== undefined);

        const lastOpacity = this.outlineMaterial!.opacity;
        applyBaseColorToMaterial(
            this.outlineMaterial!,
            this.outlineMaterial!.color,
            this.technique,
            this.technique.lineColor!,
            context.env
        );

        if (lastOpacity !== this.outlineMaterial!.opacity) {
            for (const entry of this.outlineObjects) {
                if (entry.tile.frameNumLastVisible === context.frameNumber) {
                    entry.object.visible = this.outlineMaterial!.opacity > 0;
                }
            }
        }
    }
}

techniqueHandlers.fill = FillTechniqueHandler;
