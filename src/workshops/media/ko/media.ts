﻿import * as ko from "knockout";
import template from "./media.html";
import * as Utils from "@paperbits/common/utils";
import { IMediaService } from "@paperbits/common/media";
import { ViewManager, View } from "@paperbits/common/ui";
import { IContentDropHandler, IContentDescriptor } from "@paperbits/common/editing";
import { MediaItem, defaultFileName, defaultURL } from "./mediaItem";
import { MediaContract } from "@paperbits/common/media/mediaContract";
import { Keys } from "@paperbits/common/keyboard";
import { EventManager } from "@paperbits/common/events";
import { Component, OnMounted } from "@paperbits/common/ko/decorators";
import { IWidgetService } from "@paperbits/common/widgets";
import { ChangeRateLimit } from "@paperbits/common/ko/consts";
import { Query, Operator } from "@paperbits/common/persistence";

@Component({
    selector: "media",
    template: template
})
export class MediaWorkshop {
    private nextPageQuery: Query<MediaContract>;

    public readonly searchPattern: ko.Observable<string>;
    public readonly mediaItems: ko.ObservableArray<MediaItem>;
    public readonly selectedMediaItem: ko.Observable<MediaItem>;
    public readonly working: ko.Observable<boolean>;

    constructor(
        private readonly eventManager: EventManager,
        private readonly mediaService: IMediaService,
        private readonly viewManager: ViewManager,
        private readonly dropHandlers: IContentDropHandler[],
        private readonly widgetService: IWidgetService
    ) {
        this.working = ko.observable(false);
        this.mediaItems = ko.observableArray<MediaItem>();
        this.searchPattern = ko.observable<string>("");
        this.selectedMediaItem = ko.observable<MediaItem>();
    }

    @OnMounted()
    public async initialize(): Promise<void> {
        await this.searchMedia();

        this.searchPattern
            .extend(ChangeRateLimit)
            .subscribe(this.searchMedia);
    }

    private async searchMedia(searchPattern: string = ""): Promise<void> {
        this.mediaItems([]);

        let query = Query
            .from<MediaContract>()
            .orderBy("fileName");

        if (searchPattern) {
            query = query.where("fileName", Operator.contains, searchPattern);
        }

        this.nextPageQuery = query;
        await this.loadNextPage();
        // const mediaFiles = await this.mediaService.search(searchPattern);

        // mediaFiles.forEach(async media => {
        //     const mediaItem = new MediaItem(media);
        //     const descriptor = this.findContentDescriptor(media);

        //     if (descriptor && descriptor.getWidgetOrder) {
        //         const order = await descriptor.getWidgetOrder();
        //         mediaItem.widgetOrder = order;
        //     }

        //     this.mediaItems.push(mediaItem);
        // });
    }

    public async loadNextPage(): Promise<void> {
        if (!this.nextPageQuery || this.working()) {
            return;
        }

        this.working(true);

        await Utils.delay(2000);
        const pageOfResults = await this.mediaService.search2(this.nextPageQuery);
        this.nextPageQuery = pageOfResults.nextPage;

        const mediaItems = pageOfResults.value.map(page => new MediaItem(page));
        this.mediaItems.push(...mediaItems);

        this.working(false);
    }

    private findContentDescriptor(media: MediaContract): IContentDescriptor {
        let result: IContentDescriptor;

        for (const handler of this.dropHandlers) {
            if (!handler.getContentDescriptorFromMedia) {
                continue;
            }

            result = handler.getContentDescriptorFromMedia(media);

            if (result) {
                return result;
            }
        }

        return result;
    }

    public async uploadMedia(): Promise<void> {
        const files = await this.viewManager.openUploadDialog();

        this.working(true);

        const uploadPromises = [];

        for (const file of files) {
            const content = await Utils.readFileAsByteArray(file);
            const uploadPromise = this.mediaService.createMedia(file.name, content, file.type);

            this.viewManager.notifyProgress(uploadPromise, "Media library", `Uploading ${file.name}...`);
            uploadPromises.push(uploadPromise);
        }

        await Promise.all(uploadPromises);
        await this.searchMedia();

        this.working(false);
    }

    public async linkMedia(): Promise<void> {
        const mediaContract = await this.mediaService.createMediaUrl(defaultFileName, defaultURL, "image/svg+xml");
        const mediaItem = new MediaItem(mediaContract);

        this.mediaItems.push(mediaItem);
        this.selectMedia(mediaItem);
    }

    public selectMedia(mediaItem: MediaItem): void {
        this.selectedMediaItem(mediaItem);

        const view: View = {
            heading: "Media file",
            component: {
                name: "media-details-workshop",
                params: {
                    mediaItem: mediaItem,
                    onDeleteCallback: () => {
                        this.searchMedia();
                    }
                }
            }
        };

        this.viewManager.openViewAsWorkshop(view);
    }

    public async deleteSelectedMedia(): Promise<void> {
        // TODO: Show confirmation dialog according to mockup
        this.viewManager.closeWorkshop("media-details-workshop");

        await this.mediaService.deleteMedia(this.selectedMediaItem().toMedia());
        await this.searchMedia();
    }

    public onDragStart(item: MediaItem): HTMLElement {
        item.widgetFactoryResult = item.widgetOrder.createWidget();

        const widgetElement = item.widgetFactoryResult.element;
        const widgetModel = item.widgetFactoryResult.widgetModel;
        const widgetBinding = item.widgetFactoryResult.widgetBinding;

        this.viewManager.beginDrag({
            sourceModel: widgetModel,
            sourceBinding: widgetBinding
        });

        return widgetElement;
    }

    public onDragEnd(item: MediaItem): void {
        item.widgetFactoryResult.element.remove();
        const dragSession = this.viewManager.getDragSession();
        const acceptorBinding = dragSession.targetBinding;

        if (acceptorBinding && acceptorBinding.handler) {
            const widgetHandler = this.widgetService.getWidgetHandler(acceptorBinding.handler);
            widgetHandler.onDragDrop(dragSession);
        }

        this.eventManager.dispatchEvent("virtualDragEnd");
    }

    public onKeyDown(item: MediaItem, event: KeyboardEvent): void {
        if (event.keyCode === Keys.Delete) {
            this.deleteSelectedMedia();
        }
    }

    public isSelected(media: MediaItem): boolean {
        const selectedMedia = this.selectedMediaItem();
        return selectedMedia?.key === media.key;
    }
}