/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

import {
    Expr,
    Geometry,
    getPropertyValue,
    Group,
    SolidLineTechnique
} from "@here/harp-datasource-protocol";
import { ProjectionType } from "@here/harp-geoutils";
import { setShaderMaterialDefine, SolidLineMaterial } from "@here/harp-materials";
import { assert, chainCallbacks } from "@here/harp-utils";
import { applyBaseColorToMaterial, createMaterial } from "../DecodedTileHelpers";
import { Tile } from "../Tile";
import { techniqueHandlers, TechniqueUpdateContext, TileObjectEntry } from "./TechniqueHandler";
import { GenericTechniqueHandler, TechniqueHandlerCommon } from "./TechniqueHandlerCommon";

const tmpVector3 = new THREE.Vector3();

export class SolidLineTechniqueHandler extends GenericTechniqueHandler<SolidLineTechnique> {
    mainMaterial: SolidLineMaterial;

    secondaryMaterial?: SolidLineMaterial;

    mainObjects: TileObjectEntry[] = [];
    secondaryObjects: TileObjectEntry[] = [];

    private metricUnitIsPixel: boolean;

    constructor(technique: SolidLineTechnique, tile: Tile, context: TechniqueUpdateContext) {
        // this.technique = fillDefaults(techniqe)
        super(technique);

        this.mainMaterial = createMaterial({ technique, env: context.env }) as SolidLineMaterial;
        assert(this.mainMaterial instanceof SolidLineMaterial);

        // TODO: not sure if all the tiles of one TechniqueHandler will have same size ?
        // check how it interacts with LOD ?
        // if yes, it may be possible to create
        //   material per zoom level if we have size per zoom level
        //   worst case, installTileSizeUpdaterIfNeeded like solution for onBeforeRender! :/

        /*
        if (technique.clipping !== false && context.projection.type === ProjectionType.Planar) {
            tile.boundingBox.getSize(tmpVector3);
            console.log(
                "clipTileSize",
                (this.technique as any)._category,
                tmpVector3.x,
                tmpVector3.y,
                tile.tileKey.mortonCode(),
                tile.tileKey.level
            );
            tmpVector2.set(tmpVector3.x, tmpVector3.y);
            this.mainMaterial.clipTileSize = tmpVector2;

            // TODO: cross-tile material sharing
            this.isShareableAcrossTiles = false;
        }
        */

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

        this.metricUnitIsPixel = technique.metricUnit === "Pixel";

        if (Expr.isExpr(technique.lineWidth) || this.metricUnitIsPixel) {
            this.updaters.push(this.updateLineWidth.bind(this));
        }

        if (Expr.isExpr(technique.outlineWidth) || this.metricUnitIsPixel) {
            this.updaters.push(this.updateOutlineWidth.bind(this));
        }

        if (Expr.isExpr(technique.dashSize) || this.metricUnitIsPixel) {
            this.updaters.push(this.updateDashSize.bind(this));
        }

        if (Expr.isExpr(technique.gapSize) || this.metricUnitIsPixel) {
            this.updaters.push(this.updateGapSize.bind(this));
        }

        // TODO:
        // Now, with new approach, we don't install handlers for non-interpolated props, so
        // static widths/heights/gaps will not have unitFactor or 0.5 applied.
        // Call them manually or invent better, `createMaterial`

        if (this.technique.lineWidth !== undefined) {
            this.updateLineWidth(context);
        }
        if (this.technique.outlineWidth !== undefined) {
            this.updateOutlineWidth(context);
        }
        if (this.technique.dashSize !== undefined) {
            this.updateDashSize(context);
        }
        if (this.technique.gapSize !== undefined) {
            this.updateGapSize(context);
        }

        const fadingParam = TechniqueHandlerCommon.getFadingParams(technique, context.env);
        if (TechniqueHandlerCommon.isFadingFeatureEnabled(fadingParam)) {
            this.updaters.push(
                TechniqueHandlerCommon.updateFadingParams.bind(
                    undefined,
                    this.mainMaterial,
                    fadingParam
                )
            );
        }

        if (technique.secondaryWidth !== undefined) {
            this.secondaryMaterial = this.mainMaterial.clone();
            applyBaseColorToMaterial(
                this.secondaryMaterial,
                this.secondaryMaterial.color,
                this.technique,
                this.technique.secondaryColor ?? 0xff0000,
                context.env
            );

            if (technique.secondaryCaps !== undefined) {
                this.secondaryMaterial.caps = technique.secondaryCaps;
            }

            if (Expr.isExpr(technique.secondaryColor) || Expr.isExpr(technique.opacity)) {
                this.updaters.push(this.updateSecondaryColor.bind(this));
            }

            if (TechniqueHandlerCommon.isFadingFeatureEnabled(fadingParam)) {
                this.updaters.push(
                    TechniqueHandlerCommon.updateFadingParams.bind(
                        undefined,
                        this.secondaryMaterial,
                        fadingParam
                    )
                );
            }

            if (
                Expr.isExpr(technique.secondaryWidth) ||
                Expr.isExpr(technique.secondaryColor) ||
                Expr.isExpr(technique.opacity) ||
                this.metricUnitIsPixel
            ) {
                this.updaters.push(this.updateSecondaryWidth.bind(this));
            }

            if (technique.secondaryWidth !== undefined) {
                this.updateSecondaryWidth(context);
            }
        }
    }

    createObject(tile: Tile, srcGeometry: Geometry, group: Group) {
        const bufferGeometry = TechniqueHandlerCommon.createGenericBufferGeometry(
            this.technique,
            srcGeometry,
            group
        );
        const mainObject = new THREE.Mesh(bufferGeometry, this.mainMaterial);
        this.installTileSizeUpdaterIfNeeded(tile, mainObject, this.mainMaterial);

        mainObject.renderOrder = this.technique.renderOrder;

        tile.objects.push(mainObject);
        this.mainObjects.push({ object: mainObject, tile });

        this.installTileSizeUpdaterIfNeeded(tile, mainObject, this.mainMaterial);

        // NOTE: this is copied wholesale from TechiqueGeometryCreator
        {
            // TODO: candidate for removal, we don't generate buffer geometries with color anywhere
            if (bufferGeometry.getAttribute("color")) {
                setShaderMaterialDefine(this.mainMaterial, "USE_COLOR", true);
            }
        }

        if (this.secondaryMaterial) {
            const secondaryObject = new THREE.Mesh(bufferGeometry, this.secondaryMaterial);
            this.installTileSizeUpdaterIfNeeded(tile, secondaryObject, this.secondaryMaterial);

            secondaryObject.renderOrder =
                this.technique.secondaryRenderOrder !== undefined
                    ? this.technique.secondaryRenderOrder
                    : this.technique.renderOrder - 0.0000001;
            tile.objects.push(secondaryObject);
            this.secondaryObjects.push({ object: mainObject, tile });

            return [mainObject, secondaryObject];
        }
        TechniqueHandlerCommon.setupUserData(srcGeometry, this.technique, mainObject);
        return [mainObject];
    }

    /**
     * Now, so sharing tiles across has one drawback, that if `clipping` is enabled in
     * planar, then we have
     *
     */
    private installTileSizeUpdaterIfNeeded(
        tile: Tile,
        object: THREE.Object3D,
        material: SolidLineMaterial
    ) {
        if (this.technique.clipping !== false && tile.projection.type === ProjectionType.Planar) {
            tile.boundingBox.getSize(tmpVector3);
            const clipTileSize = new THREE.Vector2(tmpVector3.x, tmpVector3.y);
            object.onBeforeRender = chainCallbacks(
                object.onBeforeRender,
                this.updateTileSizeForClipping.bind(this, material, clipTileSize)
            );
        }
    }

    private updateTileSizeForClipping(material: SolidLineMaterial, clipTileSize: THREE.Vector2) {
        material.clipTileSize = clipTileSize;
    }

    private updateLineWidth(context: TechniqueUpdateContext) {
        const unitFactor = this.getUnitFactor(context);

        this.mainMaterial.lineWidth =
            getPropertyValue(this.technique.lineWidth, context.env) * unitFactor * 0.5;
    }

    private updateOutlineWidth(context: TechniqueUpdateContext) {
        const unitFactor = this.getUnitFactor(context);

        this.mainMaterial.outlineWidth =
            getPropertyValue(this.technique.outlineWidth, context.env) * unitFactor;
    }

    private updateDashSize(context: TechniqueUpdateContext) {
        const unitFactor = this.getUnitFactor(context);

        this.mainMaterial.dashSize =
            getPropertyValue(this.technique.dashSize, context.env) * unitFactor * 0.5;
    }

    private updateGapSize(context: TechniqueUpdateContext) {
        const unitFactor = this.getUnitFactor(context);

        this.mainMaterial.gapSize =
            getPropertyValue(this.technique.gapSize, context.env) * unitFactor * 0.5;
    }

    private updateSecondaryColor(context: TechniqueUpdateContext) {
        assert(this.secondaryMaterial !== undefined);

        const lastOpacity = this.secondaryMaterial!.opacity;
        applyBaseColorToMaterial(
            this.secondaryMaterial!,
            this.secondaryMaterial!.color,
            this.technique,
            this.technique.secondaryColor!,
            context.env
        );

        if (lastOpacity !== this.secondaryMaterial!.opacity) {
            for (const entry of this.secondaryObjects) {
                if (entry.tile.frameNumLastVisible === context.frameNumber) {
                    entry.object.visible = this.secondaryMaterial!.opacity > 0;
                }
            }
        }
    }

    private updateSecondaryWidth(context: TechniqueUpdateContext) {
        const secondaryMaterial = this.secondaryMaterial!;
        assert(this.secondaryMaterial !== undefined);

        const opacity = this.mainMaterial.opacity;

        const unitFactor = this.getUnitFactor(context);

        // Note, we assume that main materials lineWidth has been already updated
        // if dynamic.
        const techniqueLineWidth = this.mainMaterial.lineWidth;
        const techniqueSecondaryWidth =
            getPropertyValue(this.technique.secondaryWidth!, context.env) * unitFactor * 0.5;

        const actualLineWidth =
            techniqueSecondaryWidth <= techniqueLineWidth &&
            (opacity === undefined || opacity === 1)
                ? 0
                : techniqueSecondaryWidth;
        secondaryMaterial.lineWidth = actualLineWidth;
    }

    private getUnitFactor(context: TechniqueUpdateContext): number {
        return this.metricUnitIsPixel ? this.getPixelToWorld(context) : 1.0;
    }

    private getPixelToWorld(context: TechniqueUpdateContext): number {
        return (context.env.lookup("$pixelToWorld") as number) ?? 1.0;
    }
}

techniqueHandlers["solid-line"] = SolidLineTechniqueHandler;
techniqueHandlers["dashed-line"] = SolidLineTechniqueHandler;
