let img;
let ditheredImg;
let bwSlider;
let resSlider;
let randomizeButton;

function setup() {
    const canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('text-align', 'justify-between', 'center');
    controlsDiv.position(canvas.x, windowHeight - 220);

    // Black/White threshold slider
    bwSlider = createSlider(0, 255, 128);
    bwSlider.parent(controlsDiv);

    // Resolution slider for pixelation effect
    resSlider = createSlider(1, 20, 1, 1);
    resSlider.parent(controlsDiv);

    randomizeButton = createButton('Randomize');
    randomizeButton.parent(controlsDiv);
    randomizeButton.mousePressed(randomizeThreshold);

    // File input
    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    // Download button
    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);
}

function draw() {
    if (img) {
        image(img, 0, 100, width, height - 100);
        pixelateAndDitherImage();
    }
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            pixelateAndDitherImage();
        });
    }
}

function randomizeThreshold() {
    bwSlider.value(random(0, 255));
    if (img) {
        pixelateAndDitherImage();
    }
}

function pixelateAndDitherImage() {
    let resolution = resSlider.value();
    img.loadPixels();
    let threshold = bwSlider.value();

    for (let y = 0; y < img.height; y += resolution) {
        for (let x = 0; x < img.width; x += resolution) {
            let index = (x + y * img.width) * 4;
            let gray = 0;

            // Calculate the average grayscale value of the block
            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    gray += (img.pixels[nindex] + img.pixels[nindex + 1] + img.pixels[nindex + 2]) / 3;
                }
            }
            gray /= resolution * resolution;

            // Apply dithering based on the average gray value
            let color = gray > threshold ? 255 : 0;
            for (let ny = y; ny < y + resolution && ny < img.height; ny++) {
                for (let nx = x; nx < x + resolution && nx < img.width; nx++) {
                    let nindex = (nx + ny * img.width) * 4;
                    img.pixels[nindex] = img.pixels[nindex + 1] = img.pixels[nindex + 2] = color;
                }
            }
        }
    }
    img.updatePixels();
}

function downloadImage() {
    if (img) {
        save(img, 'dithered_image.png');
    }
}
