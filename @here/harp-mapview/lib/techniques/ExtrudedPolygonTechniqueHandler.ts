/*
 * Copyright (C) 2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

import {
    BufferAttribute,
    Expr,
    ExtrudedPolygonTechnique,
    Geometry,
    getPropertyValue,
    Group
} from "@here/harp-datasource-protocol";
import {
    EdgeMaterial,
    EdgeMaterialParameters,
    ExtrusionFeature,
    MapMeshBasicMaterial,
    MapMeshStandardMaterial,
    FadingFeature
} from "@here/harp-materials";
import { assert } from "@here/harp-utils";
import { AnimatedExtrusionTileHandler } from "../AnimatedExtrusionHandler";
import {
    applyBaseColorToMaterial,
    applySecondaryColorToMaterial,
    createMaterial,
    getBufferAttribute
} from "../DecodedTileHelpers";
import {
    createDepthPrePassMesh,
    isRenderDepthPrePassEnabled,
    setDepthPrePassStencil
} from "../DepthPrePass";
import { Tile } from "../Tile";
import { techniqueHandlers, TechniqueUpdateContext, TileObjectEntry } from "./TechniqueHandler";
import { GenericTechniqueHandler, TechniqueHandlerCommon } from "./TechniqueHandlerCommon";

export class ExtrudedPolygonTechniqueHandler extends GenericTechniqueHandler<
    ExtrudedPolygonTechnique
> {
    mainMaterial: MapMeshBasicMaterial | MapMeshStandardMaterial;

    edgeMaterial?: EdgeMaterial;

    /**
     * Meshes with `mainMaterial` (+depth pre-pass mesh) with visibility that depends on
     * dynamic `opacity`.
     */
    mainObjects: TileObjectEntry[] = [];

    /**
     * Meshes `edgeMaterial` with visibility that depends on dynamic `opacity`.
     */
    edgeObjects: TileObjectEntry[] = [];

    extrusionAnimationEnabled: boolean = false;
    extrusionAnimationDuration?: number;

    constructor(technique: ExtrudedPolygonTechnique, tile: Tile, context: TechniqueUpdateContext) {
        // this.technique = fillDefaults(techniqe)
        super(technique);
        this.mainMaterial = createMaterial({ technique, env: context.env }) as
            | MapMeshBasicMaterial
            | MapMeshStandardMaterial;
        assert(
            this.mainMaterial instanceof MapMeshBasicMaterial ||
                this.mainMaterial instanceof MapMeshStandardMaterial
        );

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
            this.mainMaterial instanceof MapMeshStandardMaterial &&
            Expr.isExpr(technique.emissive)
        ) {
            this.updaters.push(this.updateEmissive.bind(this));
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
            this.edgeMaterial = new EdgeMaterial(materialParams);

            if (TechniqueHandlerCommon.isFadingFeatureEnabled(fadingParams)) {
                this.updaters.push(
                    TechniqueHandlerCommon.updateEdgeFadingParams.bind(
                        undefined,
                        this.edgeMaterial,
                        fadingParams
                    )
                );
            }

            if (Expr.isExpr(technique.lineColor) || Expr.isExpr(technique.opacity)) {
                this.updaters.push(this.updateLineColor.bind(this));
            }
        }

        const animatedExtrusionHandler = tile.mapView.animatedExtrusionHandler;
        if (animatedExtrusionHandler !== undefined) {
            let animateExtrusionValue = getPropertyValue(
                technique.animateExtrusion,
                tile.mapView.env // TODO: discrete env!
            );
            if (animateExtrusionValue !== undefined) {
                animateExtrusionValue =
                    typeof animateExtrusionValue === "boolean"
                        ? animateExtrusionValue
                        : typeof animateExtrusionValue === "number"
                        ? animateExtrusionValue !== 0
                        : false;
            }
            this.extrusionAnimationEnabled =
                animateExtrusionValue !== undefined &&
                animatedExtrusionHandler.forceEnabled === false
                    ? animateExtrusionValue
                    : animatedExtrusionHandler.enabled;

            this.extrusionAnimationDuration =
                this.technique.animateExtrusionDuration !== undefined &&
                animatedExtrusionHandler.forceEnabled === false
                    ? technique.animateExtrusionDuration
                    : animatedExtrusionHandler.duration;
        }
        if (this.extrusionAnimationEnabled) {
            this.isShareableAcrossTiles = false;
        }
    }

    createObject(tile: Tile, srcGeometry: Geometry, group?: Group) {
        const bufferGeometry = TechniqueHandlerCommon.createGenericBufferGeometry(
            this.technique,
            srcGeometry,
            group
        );
        const mainObject = new THREE.Mesh(bufferGeometry, this.mainMaterial);
        mainObject.name = "ept-main";

        TechniqueHandlerCommon.setupUserData(srcGeometry, this.technique, mainObject);

        mainObject.renderOrder = this.technique.renderOrder;

        const objects: THREE.Object3D[] = [];

        objects.push(mainObject);

        this.mainObjects.push({ object: mainObject, tile });

        const renderDepthPrePass = isRenderDepthPrePassEnabled(this.technique);

        if (renderDepthPrePass) {
            const depthPassMesh = createDepthPrePassMesh(mainObject as THREE.Mesh);
            depthPassMesh.name = "ept-depth-pre-pass";
            // Set geometry kind for depth pass mesh so that it gets the displacement map
            // for elevation overlay.
            objects.push(depthPassMesh);
            this.mainObjects.push({ tile, object: depthPassMesh });

            setDepthPrePassStencil(depthPassMesh, mainObject);
        }

        if (this.edgeMaterial && srcGeometry.edgeIndex) {
            const edgeGeometry = new THREE.BufferGeometry();
            edgeGeometry.setAttribute("position", bufferGeometry.getAttribute("position"));

            const colorAttribute = bufferGeometry.getAttribute("color");
            if (colorAttribute !== undefined) {
                edgeGeometry.setAttribute("color", colorAttribute);
            }

            const extrusionAttribute = bufferGeometry.getAttribute("extrusionAxis");
            if (extrusionAttribute !== undefined) {
                edgeGeometry.setAttribute("extrusionAxis", extrusionAttribute);
            }

            const normalAttribute = bufferGeometry.getAttribute("normal");
            if (normalAttribute !== undefined) {
                edgeGeometry.setAttribute("normal", normalAttribute);
            }

            const uvAttribute = bufferGeometry.getAttribute("uv");
            if (uvAttribute !== undefined) {
                edgeGeometry.setAttribute("uv", uvAttribute);
            }

            edgeGeometry.setIndex(getBufferAttribute(srcGeometry.edgeIndex! as BufferAttribute));

            const edgeObject = new THREE.LineSegments(edgeGeometry, this.edgeMaterial);
            edgeObject.name = "ept-edge";
            edgeObject.renderOrder = mainObject.renderOrder + 0.1;

            this.edgeObjects.push({ tile, object: edgeObject });
            objects.push(edgeObject);
        }

        if (this.extrusionAnimationEnabled) {
            if (tile.animatedExtrusionTileHandler === undefined) {
                tile.animatedExtrusionTileHandler = new AnimatedExtrusionTileHandler(
                    tile,
                    [],
                    this.extrusionAnimationDuration!
                );
                tile.mapView.animatedExtrusionHandler.add(tile.animatedExtrusionTileHandler);
            }
            for (const obj of objects) {
                assert(obj.onBeforeRender === THREE.Object3D.prototype.onBeforeRender);
                obj.onBeforeRender = this.updateExtrusionRatio.bind(
                    this,
                    tile.animatedExtrusionTileHandler
                );
                obj.onAfterRender = () => {
                    ((obj as THREE.Mesh | THREE.LineSegments)
                        .material as ExtrusionFeature).extrusionRatio = 1.0;
                };
            }
            this.isShareableAcrossTiles = false;
        }

        return objects;
    }

    private updateExtrusionRatio(
        animatedExtrusionTileHandler: AnimatedExtrusionTileHandler,
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera,
        geometry: THREE.Geometry | THREE.BufferGeometry,
        material: THREE.Material
    ) {
        console.log(
            "#updateExtrusionRatio",
            animatedExtrusionTileHandler.tile.mapView.frameNumber,
            animatedExtrusionTileHandler.tile.tileKey.mortonCode(),
            animatedExtrusionTileHandler.extrusionRatio
        );
        /*
        if (animatedExtrusionTileHandler.animationState === AnimatedExtrusionState.Finished) {
            // remove handler if animation finished
            material.extrusionRatio = ExtrusionFeatureDefs.DEFAULT_RATIO_MAX;
            object.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
        }
        */
        (material as ExtrusionFeature).extrusionRatio = animatedExtrusionTileHandler.extrusionRatio;
    }

    private updateLineColor(context: TechniqueUpdateContext) {
        assert(this.edgeMaterial !== undefined);

        const lastOpacity = this.edgeMaterial!.opacity;
        applyBaseColorToMaterial(
            this.edgeMaterial!,
            this.edgeMaterial!.color,
            this.technique,
            this.technique.lineColor!,
            context.env
        );

        if (lastOpacity !== this.edgeMaterial!.opacity) {
            for (const entry of this.edgeObjects) {
                if (entry.tile.frameNumLastVisible === context.frameNumber) {
                    entry.object.visible = this.edgeMaterial!.opacity > 0;
                }
            }
        }
    }

    private updateEmissive(context: TechniqueUpdateContext) {
        assert(this.mainMaterial instanceof MapMeshStandardMaterial);

        applySecondaryColorToMaterial(
            (this.mainMaterial as MapMeshStandardMaterial).emissive,
            this.technique.emissive!,
            context.env
        );
    }
}

techniqueHandlers["extruded-polygon"] = ExtrudedPolygonTechniqueHandler;
