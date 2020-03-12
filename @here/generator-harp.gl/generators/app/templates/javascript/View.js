/*
 * Copyright (C) 2017-2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { MapControls } from "@here/harp-map-controls";
import { CopyrightElementHandler, MapView } from "@here/harp-mapview";
import { APIFormat, AuthenticationMethod, OmvDataSource } from "@here/harp-omv-datasource";

const defaultTheme = "resources/berlin_tilezen_base.json";

export class View {
    constructor(args) {
        this.canvas = args.canvas;
        this.theme = args.theme === undefined ? defaultTheme : args.theme;
        this.mapView = this.initialize();
    }

    initialize() {
        const mapView = new MapView({
            canvas: this.canvas,
            theme: this.theme,
            decoderUrl: "decoder.bundle.js"
        });
        CopyrightElementHandler.install("copyrightNotice")
            .attach(mapView)
            .setDefaults([
                {
                    id: "here.com",
                    label: "HERE",
                    link: "https://legal.here.com/terms",
                    year: 2019
                }
            ]);
        const omvDataSource = new OmvDataSource({
            baseUrl: "https://vector.hereapi.com/v2/vectortiles/base/mc",
            apiFormat: APIFormat.XYZOMV,
            styleSetName: "tilezen",
            authenticationCode: "<%= apikey %>",
            authenticationMethod: {
                  method: AuthenticationMethod.QueryString,
                  name: "apikey"
            }
        });
        mapView.addDataSource(omvDataSource);
        MapControls.create(mapView);
        return mapView;
    }
}
